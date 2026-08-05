//go:build !windows

package main

import (
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// On non-Windows platforms we fall back to the plain Wails dialogs instead of
// the native COM pickers used on Windows.

func showOpenFilesDialog(_ uintptr, title string) ([]string, error) {
	app := application.Get()
	if app == nil {
		return nil, errors.New("application not available")
	}
	return app.Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(true).
		CanChooseDirectories(false).
		PromptForMultipleSelection()
}

func showOpenFolderDialog(_ uintptr, title string) ([]string, error) {
	app := application.Get()
	if app == nil {
		return nil, errors.New("application not available")
	}
	dir, err := app.Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(false).
		CanChooseDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if dir == "" {
		return nil, nil // user cancelled
	}
	return []string{dir}, nil
}
