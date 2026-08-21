package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Remote updates -----------------------------------------------------------
//
// The website publishes a manifest at /latest.json next to the installer:
//
//	{"version": "1.4.0", "url": "/sharknote-setup.exe",
//	 "sha256": "…", "notes": "…"}
//
// On startup (and on demand from Settings) the app compares its built-in
// AppVersion against the manifest. If a newer version is published, the UI
// offers to download it. The download is streamed to a temp file while the
// progress is broadcast to the frontend, verified against the manifest's
// SHA-256, and — once the user confirms — the signed installer is run
// silently (/S). The NSIS script stops the running app, replaces its files
// (notes in %APPDATA% are never touched) and the helper relaunches the new
// build afterwards, which is the "reload" that finishes the update.

const (
	// Production manifest base. Override with SHARKNOTE_UPDATE_BASE for
	// staging/testing (e.g. a preview deployment).
	defaultUpdateBaseURL = "https://sharknote.pages.dev"

	updateProgressEvent = "sharknote:update-progress"

	downloadHTTPTimeout = 30 * time.Second
	downloadMaxBytes    = 512 << 20 // sanity ceiling: 512 MB
)

// updateProgress is emitted to the frontend while the installer downloads.
type updateProgress struct {
	Stage      string `json:"stage"` // "downloading" | "done" | "error"
	Percent    int    `json:"percent"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}

type updateManifest struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Notes   string `json:"notes,omitempty"`
}

// UpdateInfo is returned to the frontend by CheckForUpdate.
type UpdateInfo struct {
	Available bool   `json:"available"`
	Version   string `json:"version"` // the running version
	Latest    string `json:"latest"`  // the newest published version
	Notes     string `json:"notes,omitempty"`
}

// UpdaterService exposes remote update checks to the frontend bindings.
type UpdaterService struct {
	mu             sync.Mutex
	client         *http.Client
	baseURL        string
	downloadedPath string
	downloadedSHA  string
}

func NewUpdaterService() *UpdaterService {
	return &UpdaterService{
		client: &http.Client{Timeout: downloadHTTPTimeout},
	}
}

func updateBaseURL() string {
	if v := os.Getenv("SHARKNOTE_UPDATE_BASE"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultUpdateBaseURL
}

// CurrentVersion reports the running app version.
func (u *UpdaterService) CurrentVersion() string {
	return AppVersion
}

// CheckForUpdate fetches the published manifest and compares it with the
// running version. A network failure is returned as an error so the UI can
// stay silent instead of nagging.
func (u *UpdaterService) CheckForUpdate() (*UpdateInfo, error) {
	mf, err := fetchManifest(context.Background(), u.client)
	if err != nil {
		return nil, err
	}
	info := &UpdateInfo{
		Version: AppVersion,
		Latest:  mf.Version,
		Notes:   mf.Notes,
	}
	info.Available = isNewerVersion(mf.Version, AppVersion)
	return info, nil
}

// DownloadUpdate streams the published installer into a temp file, emitting
// sharknote:update-progress events along the way, and verifies its SHA-256
// against the manifest before declaring it ready.
func (u *UpdaterService) DownloadUpdate() error {
	u.mu.Lock()
	if u.downloadedPath != "" {
		u.mu.Unlock()
		return nil // already downloaded and verified
	}
	u.mu.Unlock()

	mf, err := fetchManifest(context.Background(), u.client)
	if err != nil {
		return err
	}
	if !isNewerVersion(mf.Version, AppVersion) {
		return errors.New("no update available")
	}
	if mf.SHA256 == "" {
		return errors.New("manifest is missing the sha256 checksum")
	}

	url := mf.URL
	if !strings.Contains(url, "://") {
		url = updateBaseURL() + url
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength
	tmp := filepath.Join(os.TempDir(), "sharknote-update-setup.exe")
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	defer out.Close()

	hasher := sha256.New()
	var downloaded int64
	var lastEmit time.Time
	buf := make([]byte, 64*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			downloaded += int64(n)
			if downloaded > downloadMaxBytes {
				out.Close()
				os.Remove(tmp)
				return errors.New("download exceeds the expected size")
			}
			if _, werr := out.Write(buf[:n]); werr != nil {
				os.Remove(tmp)
				return werr
			}
			if _, werr := hasher.Write(buf[:n]); werr != nil {
				os.Remove(tmp)
				return werr
			}
			// Throttle progress events to a handful per second.
			if total > 0 && time.Since(lastEmit) > 200*time.Millisecond {
				lastEmit = time.Now()
				emitUpdateProgress(updateProgress{
					Stage:      "downloading",
					Percent:    int(100 * downloaded / total),
					Downloaded: downloaded,
					Total:      total,
				})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			os.Remove(tmp)
			return readErr
		}
	}

	got := hex.EncodeToString(hasher.Sum(nil))
	want := strings.ToLower(strings.TrimSpace(mf.SHA256))
	if !strings.EqualFold(got, want) {
		os.Remove(tmp)
		emitUpdateProgress(updateProgress{Stage: "error"})
		return fmt.Errorf("checksum mismatch: downloaded file does not match the published SHA-256")
	}

	u.mu.Lock()
	u.downloadedPath = tmp
	u.downloadedSHA = got
	u.mu.Unlock()

	emitUpdateProgress(updateProgress{
		Stage:      "done",
		Percent:    100,
		Downloaded: downloaded,
		Total:      total,
	})
	return nil
}

// ApplyUpdate runs the downloaded installer silently and quits the app. The
// installer stops the running instance, swaps the files and the helper
// relaunches Sharknote — the user's "reload".
func (u *UpdaterService) ApplyUpdate() error {
	u.mu.Lock()
	path := u.downloadedPath
	u.mu.Unlock()
	if path == "" {
		return errors.New("no update has been downloaded yet")
	}
	if _, err := os.Stat(path); err != nil {
		u.mu.Lock()
		u.downloadedPath = ""
		u.mu.Unlock()
		return errors.New("the downloaded update is missing; download it again")
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, err = filepath.Abs(exe)
	if err != nil {
		return err
	}

	// Detached helper: run the silent installer, clean up the temp file,
	// then bring the freshly installed build back up.
	script := fmt.Sprintf(
		`$null = Start-Process -FilePath '%s' -ArgumentList '/S' -Wait; `+
			`Remove-Item -LiteralPath '%s' -ErrorAction SilentlyContinue; `+
			`Start-Sleep -Milliseconds 400; Start-Process -FilePath '%s'`,
		path, path, exe)
	if err := launchDetached("powershell", "-NoProfile", "-NonInteractive",
		"-WindowStyle", "Hidden", "-Command", script); err != nil {
		return err
	}

	if app := application.Get(); app != nil {
		app.Quit()
	}
	return nil
}

// --- internals -------------------------------------------------------------

func fetchManifest(ctx context.Context, client *http.Client) (*updateManifest, error) {
	url := updateBaseURL() + "/latest.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach the update server: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update manifest unavailable (HTTP %d)", resp.StatusCode)
	}
	var mf updateManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&mf); err != nil {
		return nil, fmt.Errorf("invalid update manifest: %w", err)
	}
	if mf.Version == "" || mf.URL == "" {
		return nil, errors.New("invalid update manifest")
	}
	return &mf, nil
}

// isNewerVersion compares dotted numeric versions ("1.4.0" > "1.3.12").
// Anything unparsable is treated as "not newer" so a broken manifest can
// never trigger a downgrade loop.
func isNewerVersion(latest, current string) bool {
	l, lok := parseVersion(latest)
	c, cok := parseVersion(current)
	if !lok || !cok {
		return false
	}
	for i := 0; i < 3; i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	parts := strings.Split(strings.TrimSpace(strings.TrimPrefix(strings.ToLower(v), "v")), ".")
	if len(parts) == 0 {
		return out, false
	}
	for i := 0; i < len(parts) && i < 3; i++ {
		n, ok := atoiStrict(parts[i])
		if !ok {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

func atoiStrict(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, false
		}
		n = n*10 + int(ch-'0')
		if n > 1_000_000 {
			return 0, false
		}
	}
	return n, true
}

func emitUpdateProgress(p updateProgress) {
	if app := application.Get(); app != nil {
		app.Event.Emit(updateProgressEvent, p)
	}
}
