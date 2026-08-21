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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Remote updates -----------------------------------------------------------
//
// The website publishes a manifest at /latest.json next to the installer:
//
//	{"version": "1.5.1", "url": "/sharknote-setup.exe",
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
//
// Reliability notes (lessons from the field):
//   - The manifest is fetched with cache-busting, so a stale CDN copy can
//     never make an updated app keep offering the same version.
//   - A downloaded+verified installer is recorded in a marker file next to
//     the notes DB, so restarting the app between "download" and "reload"
//     doesn't lose the update or force a re-download.
//   - ApplyUpdate writes a .cmd script (no PowerShell quoting pitfalls) and
//     relaunches the INSTALLED exe (from the registry InstallLocation), so
//     the update lands where users actually launch Sharknote from.

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
	// Ready is true when a verified installer is already on disk (downloaded
	// now or in a previous session), so the UI can offer "reload" directly.
	Ready bool `json:"ready"`
}

// UpdaterService exposes remote update checks to the frontend bindings.
type UpdaterService struct {
	mu             sync.Mutex
	client         *http.Client
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

// pendingUpdateMarker is the file that records a downloaded+verified
// installer across app restarts. It lives next to the notes DB.
func pendingUpdateMarker() string {
	if p := os.Getenv("SHARKNOTE_DB"); p != "" {
		return filepath.Join(filepath.Dir(p), "pending-update.json")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "sharknote", "pending-update.json")
}

type pendingUpdate struct {
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	Version   string `json:"version"`
	StartedAt string `json:"startedAt"`
}

func readPendingUpdate() *pendingUpdate {
	marker := pendingUpdateMarker()
	if marker == "" {
		return nil
	}
	data, err := os.ReadFile(marker)
	if err != nil {
		return nil
	}
	var p pendingUpdate
	if json.Unmarshal(data, &p) != nil || p.Path == "" {
		return nil
	}
	if _, err := os.Stat(p.Path); err != nil {
		return nil // installer file is gone
	}
	return &p
}

func writePendingUpdate(p pendingUpdate) {
	marker := pendingUpdateMarker()
	if marker == "" {
		return
	}
	if data, err := json.MarshalIndent(p, "", "  "); err == nil {
		_ = os.WriteFile(marker, data, 0o644)
	}
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
	if info.Available {
		// A verified installer from an earlier session counts as ready.
		if p := readPendingUpdate(); p != nil && strings.EqualFold(p.SHA256, strings.TrimSpace(mf.SHA256)) {
			u.mu.Lock()
			u.downloadedPath = p.Path
			u.downloadedSHA = p.SHA256
			u.mu.Unlock()
			info.Ready = true
		}
	}
	return info, nil
}

// DownloadUpdate streams the published installer into a temp file, emitting
// sharknote:update-progress events along the way, and verifies its SHA-256
// against the manifest before declaring it ready.
func (u *UpdaterService) DownloadUpdate() error {
	mf, err := fetchManifest(context.Background(), u.client)
	if err != nil {
		return err
	}
	if !isNewerVersion(mf.Version, AppVersion) {
		return errors.New("no update available")
	}
	want := strings.ToLower(strings.TrimSpace(mf.SHA256))
	if want == "" {
		return errors.New("manifest is missing the sha256 checksum")
	}

	// Already have a verified installer for this exact version? Reuse it.
	u.mu.Lock()
	if u.downloadedPath != "" && u.downloadedSHA == want {
		u.mu.Unlock()
		emitUpdateProgress(updateProgress{Stage: "done", Percent: 100})
		return nil
	}
	u.mu.Unlock()
	if p := readPendingUpdate(); p != nil && strings.EqualFold(p.SHA256, want) {
		u.mu.Lock()
		u.downloadedPath = p.Path
		u.downloadedSHA = p.SHA256
		u.mu.Unlock()
		emitUpdateProgress(updateProgress{Stage: "done", Percent: 100})
		return nil
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
	req.Header.Set("Cache-Control", "no-cache")
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
	out.Close()

	got := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(got, want) {
		os.Remove(tmp)
		emitUpdateProgress(updateProgress{Stage: "error"})
		return fmt.Errorf("checksum mismatch: downloaded file does not match the published SHA-256")
	}

	// Remember the verified installer across restarts.
	writePendingUpdate(pendingUpdate{
		Path:      tmp,
		SHA256:    got,
		Version:   mf.Version,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	})

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
// installer stops any running instance, swaps the files and the helper
// relaunches the installed Sharknote — the user's "reload".
func (u *UpdaterService) ApplyUpdate() error {
	u.mu.Lock()
	path := u.downloadedPath
	u.mu.Unlock()

	// Fall back to the marker (e.g. the app was restarted since downloading).
	if path == "" {
		if p := readPendingUpdate(); p != nil {
			path = p.Path
		}
	}
	if path == "" {
		return errors.New("no update has been downloaded yet")
	}
	if _, err := os.Stat(path); err != nil {
		// Installer vanished — drop the stale state and ask for a re-download.
		if marker := pendingUpdateMarker(); marker != "" {
			os.Remove(marker)
		}
		u.mu.Lock()
		u.downloadedPath = ""
		u.downloadedSHA = ""
		u.mu.Unlock()
		return errors.New("the downloaded update is missing; download it again")
	}

	// Relaunch the INSTALLED app (where users actually start it from), not
	// necessarily the process we're running under (e.g. a dev build).
	target := installedAppPath()
	if target == "" {
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		target, err = filepath.Abs(exe)
		if err != nil {
			return err
		}
	}

	// Write a tiny .cmd script instead of fighting shell quoting rules.
	scriptPath := filepath.Join(os.TempDir(), strconv.Itoa(int(time.Now().UnixNano()))+"-sharknote-update.cmd")
	script := strings.Join([]string{
		"@echo off",
		"\"" + path + "\" /S",
		"del /q \"" + path + "\" >nul 2>&1",
		"del /q \"" + pendingUpdateMarker() + "\" >nul 2>&1",
		"ping -n 2 127.0.0.1 >nul", // ~1s grace period, no console input needed
		"start \"\" \"" + target + "\"",
	}, "\r\n") + "\r\n"
	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		return err
	}

	if err := launchDetached("cmd", "/c", scriptPath); err != nil {
		os.Remove(scriptPath)
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
	// Never let a stale CDN copy make an updated app re-offer the update.
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
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
