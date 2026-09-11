//go:build windows

package main

import (
	"os/exec"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func dialogOwner() uintptr {
	if app := application.Get(); app != nil {
		if w := app.Window.Current(); w != nil {
			return uintptr(w.NativeWindow())
		}
	}
	return 0
}

// pickAttachmentPath opens the native single-file picker (any file type).
func pickAttachmentPath() ([]string, error) {
	return showOpenFilesDialog(dialogOwner(), "Attach file")
}

// saveAttachmentAs opens the native save dialog seeded with the original
// filename; returns "" when the user cancels.
func saveAttachmentAs(defaultName string) (string, error) {
	return showSaveFileDialog(dialogOwner(), defaultName)
}

// openPathWithDefaultApp launches the OS handler (explorer start) detached.
func openPathWithDefaultApp(path string) error {
	cmd := exec.Command("cmd.exe", "/c", "start", "", path)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

// pickMediaPath opens the native picker filtered to image/video files.
func pickMediaPath() ([]string, error) {
	return showOpenMediaDialog(dialogOwner(), "Insert image or video")
}
