package main

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// handleOpenedFile imports a .md file handed to the app by the OS (either at
// launch or via a second-instance forward), then tells the frontend to open
// the resulting note.
func handleOpenedFile(service *NoteService, app *application.App, path string) {
	note, err := service.ImportFile(path)
	if err != nil {
		log.Printf("failed to import opened file %q: %v", path, err)
		return
	}
	// Remember for the frontend in case it hasn't finished loading yet.
	service.SetPendingOpenedNote(note.ID)
	// Notify a running frontend right away.
	app.Event.Emit("sharknote:file-opened", note.ID)
	if w := app.Window.Current(); w != nil {
		w.Focus()
	}
}
