//go:build windows

package main

import (
	"os/exec"
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
