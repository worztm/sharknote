//go:build windows

package main

import (
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// launchDetached starts a process fully detached from the GUI app: its own
// process group, no console window flashing over the webview.
func launchDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // DETACHED_PROCESS
	}
	return cmd.Start()
}

// installedAppPath returns the full path of the installed Sharknote exe by
// reading the uninstall registry key the NSIS installer writes. Returns ""
// when the app isn't installed (e.g. a dev build run from bin/).
func installedAppPath() string {
	keys := []string{
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Sharknote`,
		`HKCU\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Sharknote`,
	}
	for _, key := range keys {
		out, err := exec.Command("reg", "query", key, "/v", "InstallLocation").Output()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(out), "\n") {
			if !strings.Contains(line, "InstallLocation") || !strings.Contains(line, "REG_SZ") {
				continue
			}
			idx := strings.Index(line, "REG_SZ")
			p := strings.Trim(strings.TrimSpace(line[idx+len("REG_SZ"):]), `"`)
			if p != "" {
				return filepath.Join(p, "sharknote.exe")
			}
		}
	}
	return ""
}
