package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

	manifestHTTPTimeout = 30 * time.Second // whole manifest exchange
	downloadMaxBytes    = 512 << 20        // sanity ceiling: 512 MB
)

// updateBaseDevOverride is true when SHARKNOTE_UPDATE_BASE was set by the
// developer. It is the only way an arbitrary base (possibly non-https, e.g.
// a local preview server) is accepted.
var updateBaseDevOverride = os.Getenv("SHARKNOTE_UPDATE_BASE") != ""

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
	Sig     string `json:"sig,omitempty"` // hex Ed25519 over "version\nurl\nsha256\nnotes"
}

// updatePubKeyHex is the Ed25519 public key matching the maintainer's offline
// signing key. The manifest signature is verified against THIS constant,
// which is baked into the compiled exe: an attacker who fully compromises the
// website or the Cloudflare account still cannot publish an update the app
// will accept, because they cannot forge a signature without the private key.
// Rotate by rebuilding the app with a new constant.
const updatePubKeyHex = "1c953494506ae8b3f4027c050f8dcadd62178e86678e25d7484d20cd92a53db8"

// canonicalManifestBytes is the exact byte sequence the signing script
// (website/scripts/prepare-installer.mjs) signs. Keep both in sync.
func canonicalManifestBytes(m *updateManifest) []byte {
	return []byte(m.Version + "\n" + m.URL + "\n" + strings.ToLower(m.SHA256) + "\n" + m.Notes)
}

func verifyManifestSig(m *updateManifest) error {
	if m.Sig == "" {
		return errors.New("update manifest is not signed")
	}
	pub, err := hex.DecodeString(updatePubKeyHex)
	if err != nil || len(pub) != 32 {
		return errors.New("invalid embedded update public key")
	}
	sig, err := hex.DecodeString(m.Sig)
	if err != nil {
		return errors.New("manifest signature is not valid hex")
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), canonicalManifestBytes(m), sig) {
		return errors.New("manifest signature does not verify - refusing the update")
	}
	return nil
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
// The manifest client carries a short whole-exchange timeout; the download
// client deliberately has none — a Client.Timeout covers the entire body
// read, which would cut large installers off mid-stream. Long transfers are
// instead bounded by the per-download context and downloadMaxBytes.
type UpdaterService struct {
	mu             sync.Mutex
	manifestClient *http.Client
	downloadClient *http.Client
	downloadedPath string
	downloadedSHA  string
}

func NewUpdaterService() *UpdaterService {
	return &UpdaterService{
		manifestClient: &http.Client{Timeout: manifestHTTPTimeout},
		downloadClient: &http.Client{},
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
func updateStateDir() string {
	if p := os.Getenv("SHARKNOTE_DB"); p != "" {
		return filepath.Dir(p)
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "sharknote")
}

func pendingUpdateMarker() string {
	dir := updateStateDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "pending-update.json")
}

// updateLogPath is where the apply script records what happened — the first
// place to look if an update ever fails to apply.
func updateLogPath() string {
	dir := updateStateDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "update.log")
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

// CheckForUpdate fetches the published manifest and compares it with the
// running version. A network failure is returned as an error so the UI can
// stay silent instead of nagging.
func (u *UpdaterService) CheckForUpdate() (*UpdateInfo, error) {
	mf, err := fetchManifest(context.Background(), u.manifestClient)
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
	mf, err := fetchManifest(context.Background(), u.manifestClient)
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
	// The URL is covered by the signature, but belt-and-braces: never leave
	// https without an explicit developer override.
	if err := validateDownloadURL(url); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := u.downloadClient.Do(req)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	total := resp.ContentLength
	// Random temp name: two instances can't clobber each other and a
	// pre-planted file at a known path can't be mistaken for it.
	tmpFile, err := os.CreateTemp("", "sharknote-update-*.exe")
	if err != nil {
		return err
	}
	tmp := tmpFile.Name()
	out := tmpFile
	// Closes the handle and deletes the partial file on every failure path.
	cleanup := func() {
		out.Close()
		os.Remove(tmp)
	}

	hasher := sha256.New()
	var downloaded int64
	var lastEmit time.Time
	buf := make([]byte, 64*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			downloaded += int64(n)
			if downloaded > downloadMaxBytes {
				cleanup()
				return errors.New("download exceeds the expected size")
			}
			if _, werr := out.Write(buf[:n]); werr != nil {
				cleanup()
				return werr
			}
			if _, werr := hasher.Write(buf[:n]); werr != nil {
				cleanup()
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
			cleanup()
			return readErr
		}
	}
	out.Close()

	got := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(got, want) {
		cleanup()
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

	// Nothing on disk is trusted here — not the downloaded state, not the
	// marker file, not the installer file itself. Re-fetch the signed
	// manifest and re-hash the installer immediately before executing it:
	// this closes both the verified-then-waited race and marker tampering
	// (the marker lives in a user-writable directory).
	mf, err := fetchManifest(context.Background(), u.manifestClient)
	if err != nil {
		return fmt.Errorf("update aborted (could not re-check the published release): %w", err)
	}
	if !isNewerVersion(mf.Version, AppVersion) {
		return errors.New("update aborted: the published version is not newer than this build")
	}
	gotNow, err := sha256File(path)
	if err != nil {
		return fmt.Errorf("update aborted (cannot read the downloaded installer): %w", err)
	}
	if !strings.EqualFold(gotNow, mf.SHA256) {
		// Stale or tampered installer — drop everything and ask for a re-download.
		if marker := pendingUpdateMarker(); marker != "" {
			os.Remove(marker)
		}
		u.mu.Lock()
		u.downloadedPath = ""
		u.downloadedSHA = ""
		u.mu.Unlock()
		return errors.New("the downloaded update does not match the published release; download it again")
	}

	// Write a tiny .cmd script instead of fighting shell quoting rules.
	// The installer itself relaunches the app after a silent install
	// (see the ${Silent} block in project.nsi) — the installer is spawned
	// here and is guaranteed to outlive this quitting process, which makes
	// the whole handoff deterministic. Every step is logged so failures
	// leave a trace in %APPDATA%\sharknote\update.log.
	scriptFile, err := os.CreateTemp("", "*-sharknote-update.cmd")
	if err != nil {
		return err
	}
	scriptPath := scriptFile.Name()
	scriptFile.Close()
	logPath := updateLogPath()
	var b strings.Builder
	b.WriteString("@echo off\r\n")
	if logPath != "" {
		b.WriteString("echo [%date% %time%] update script started >> \"" + logPath + "\"\r\n")
	}
	b.WriteString("\"" + path + "\" /S\r\n")
	if logPath != "" {
		b.WriteString("echo [%date% %time%] installer exit code %errorlevel% >> \"" + logPath + "\"\r\n")
	}
	b.WriteString("del /q \"" + path + "\" >nul 2>&1\r\n")
	if marker := pendingUpdateMarker(); marker != "" {
		b.WriteString("del /q \"" + marker + "\" >nul 2>&1\r\n")
	}
	b.WriteString("del /q \"%~f0\" >nul 2>&1\r\n")
	if err := os.WriteFile(scriptPath, []byte(b.String()), 0o600); err != nil {
		os.Remove(scriptPath)
		return err
	}

	comspec := os.Getenv("ComSpec")
	if comspec == "" {
		comspec = "cmd"
	}
	if err := launchDetached(comspec, "/c", scriptPath); err != nil {
		os.Remove(scriptPath)
		return err
	}

	if app := application.Get(); app != nil {
		app.Quit()
	}
	return nil
}

// --- internals -------------------------------------------------------------

// sha256File hashes an existing file in one pass (installer-sized, up to
// downloadMaxBytes).
func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// validateDownloadURL refuses plain-http update downloads unless the
// developer overrode the base URL (SHARKNOTE_UPDATE_BASE) for local/staging
// testing. The manifest URL itself is always the baked-in https base.
func validateDownloadURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid update URL: %w", err)
	}
	if u.Scheme != "https" && !updateBaseDevOverride {
		return errors.New("refusing to download the update over plain http")
	}
	return nil
}

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
	// Signature check BEFORE anything else uses the manifest: proves it was
	// produced by the holder of the offline private key, not by whoever
	// controls the website.
	if err := verifyManifestSig(&mf); err != nil {
		return nil, err
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
