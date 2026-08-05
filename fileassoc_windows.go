//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

// ProgID registered in the Windows registry so Sharknote appears as a
// handler for .md files ("Open with" menu, and settable as default).
const fileAssocProgID = "Sharknote.md"

// registerFileAssociation registers Sharknote in HKCU so Windows knows the
// app can open .md files. Per-user scope means no admin rights are needed.
// It is idempotent: existing entries (e.g. other OpenWithProgids for .md)
// are preserved.
func registerFileAssociation() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.Abs(exe)
	cmd := fmt.Sprintf(`"%s" "%%1"`, exe)

	// ProgID: description + icon
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+fileAssocProgID, registry.WRITE)
	if err != nil {
		return err
	}
	k.SetStringValue("", "Sharknote Markdown Note")
	k.Close()

	k, _, err = registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+fileAssocProgID+`\DefaultIcon`, registry.WRITE)
	if err != nil {
		return err
	}
	k.SetStringValue("", exe+",0")
	k.Close()

	// Open command: "C:\...\sharknote.exe" "%1"
	k, _, err = registry.CreateKey(registry.CURRENT_USER, `Software\Classes\`+fileAssocProgID+`\shell\open\command`, registry.WRITE)
	if err != nil {
		return err
	}
	k.SetStringValue("", cmd)
	k.Close()

	// Advertise under .md -> OpenWithProgids (merges with existing entries)
	k, _, err = registry.CreateKey(registry.CURRENT_USER, `Software\Classes\.md\OpenWithProgids`, registry.WRITE)
	if err != nil {
		return err
	}
	k.SetStringValue(fileAssocProgID, "")
	k.Close()

	return nil
}
