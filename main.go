package main

import (
	"embed"
	"log"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	store, err := NewStore(defaultDBPath())
	if err != nil {
		log.Fatal("failed to open note store: ", err)
	}
	defer store.Close()
	if err := store.Seed(); err != nil {
		log.Fatal("failed to seed store: ", err)
	}

	service := NewNoteService(store)

	app := application.New(application.Options{
		Name:        "Sharknote",
		Description: "A beautiful networked note-taking app with bidirectional links and a knowledge graph",
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		// Declare .md as an associated file type: when Windows launches the
		// app with a .md file (e.g. from "Open with"), Wails fires
		// ApplicationOpenedWithFile with the file path.
		FileAssociations: []string{".md"},
		// Route all launches through a single instance so opening a .md file
		// while the app is already running forwards the file to it.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.sharknote.desktop",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				for _, arg := range data.Args {
					if strings.EqualFold(filepath.Ext(arg), ".md") {
						handleOpenedFile(service, application.Get(), arg)
					}
				}
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Launched directly with a .md file (fresh instance).
	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) {
		path := event.Context().Filename()
		if path != "" {
			handleOpenedFile(service, app, path)
		}
	})

	// Make Windows aware of the association (HKCU, best-effort).
	if err := registerFileAssociation(); err != nil {
		log.Printf("failed to register .md file association: %v", err)
	}


	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:   "Sharknote",
		Width:   1150,
		Height:  740,
		MinWidth: 980,
		MinHeight: 640,
		// Medium, centered, normal-state window on every launch — the user
		// resizes/maximizes/minimizes it however they like afterwards.
		InitialPosition:  application.WindowCentered,
		StartState:       application.WindowStateNormal,
		BackgroundColour: application.NewRGB(9, 9, 11),
		URL:              "/",
		// Keep the UI at a fixed zoom. Disables the WebView2 zoom control
		// (Ctrl+wheel, Ctrl+plus/minus, pinch). The graph view has its own
		// JS-driven zoom, which is unaffected by this setting.
		ZoomControlEnabled: false,
		Windows: application.WindowsWindow{
			Theme: application.Dark,
		},
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
