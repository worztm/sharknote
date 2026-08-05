//go:build windows

package main

import (
	"os"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// TestOpenDialogsOpenAndCancel exercises the native COM dialogs end-to-end:
// each must appear, and closing it must return (nil, nil) without crashing.
// Interactive — set SHARKNOTE_TEST_DIALOG=1 to run.
func TestOpenDialogsOpenAndCancel(t *testing.T) {
	if os.Getenv("SHARKNOTE_TEST_DIALOG") == "" {
		t.Skip("set SHARKNOTE_TEST_DIALOG=1 to run the interactive dialog test")
	}

	cases := []struct {
		name  string
		title string
		show  func(owner uintptr, title string) ([]string, error)
	}{
		{"files", "Open markdown files", showOpenFilesDialog},
		{"folder", "Open folder (import vault)", showOpenFolderDialog},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			go func() {
				time.Sleep(2 * time.Second)
				user32 := syscall.NewLazyDLL("user32.dll")
				findWindow := user32.NewProc("FindWindowW")
				postMessage := user32.NewProc("PostMessageW")
				titlePtr, _ := windows.UTF16PtrFromString(tc.title)
				hwnd, _, _ := findWindow.Call(0, uintptr(unsafe.Pointer(titlePtr)))
				if hwnd == 0 {
					return // dialog never appeared — the test body will catch it
				}
				// Esc key (WM_KEYDOWN/WM_KEYUP, VK_ESCAPE = 0x1B) — same as Cancel.
				postMessage.Call(hwnd, 0x0100, 0x1B, 0) // WM_KEYDOWN
				postMessage.Call(hwnd, 0x0101, 0x1B, 0) // WM_KEYUP
			}()

			paths, err := tc.show(0, tc.title)
			if err != nil {
				t.Fatalf("dialog error: %v", err)
			}
			if paths != nil {
				t.Fatalf("expected cancellation (nil paths), got %v", paths)
			}
			t.Log("dialog opened and cancelled cleanly")
		})
	}
}
