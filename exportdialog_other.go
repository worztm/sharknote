//go:build !windows

// Fallback save dialog for non-Windows platforms: the plain Wails dialog
// builder. Sharknote only ships a Windows installer today, but the app
// still compiles on other platforms.

package main

import (
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func showSaveFileDialog(_ uintptr, defaultName string) (string, error) {
	app := application.Get()
	if app == nil {
		return "", errors.New("application not available")
	}
	path, err := app.Dialog.SaveFile().
		SetFilename(defaultName).
		SetButtonText("Save note").
		AddFilter("Markdown (*.md)", "*.md").
		AddFilter("HTML page (*.html)", "*.html;*.htm").
		AddFilter("Plain text (*.txt)", "*.txt").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return path, nil // Cancellation comes back as an empty string.
}