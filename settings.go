package main

import (
	"database/sql"
	"encoding/json"
	"strings"
)

// Settings is the user-customizable application configuration. The frontend
// treats it as one opaque bundle: it loads it at startup, applies it to the
// UI, and persists it back with UpdateSettings whenever the user changes
// anything in the settings dialog.
type Settings struct {
	// Theme controls the overall color scheme: "dark" or "light".
	Theme string `json:"theme"`
	// Accent is the hue used across the whole UI: violet | sky | emerald |
	// amber | rose. The frontend maps it to CSS oklch hue values.
	Accent string `json:"accent"`
	// GraphTheme picks the palette of the knowledge graph canvas:
	// crimson | violet | ocean | forest | amber.
	GraphTheme string `json:"graphTheme"`
	// EditorFont is the typeface of the note body: serif | sans | mono.
	EditorFont string `json:"editorFont"`
	// EditorFontSize is the note body font size in pixels (13–19).
	EditorFontSize float64 `json:"editorFontSize"`
	// DefaultView decides whether notes open in preview or edit mode.
	DefaultView string `json:"defaultView"`
	// AutosaveDelay is the debounce (ms) between typing and saving.
	AutosaveDelay int `json:"autosaveDelay"`
	// ConfirmDelete asks for confirmation before deleting a note.
	ConfirmDelete bool `json:"confirmDelete"`
	// ShowMdExtension appends ".md" to new note titles so notes look like
	// markdown files (e.g. "Meeting notes.md"). Existing notes are never
	// renamed, and a title that already ends in .md is left alone.
	ShowMdExtension bool `json:"showMdExtension"`
	// VaultPath is the last folder opened with "Open folder". Empty when
	// the user has never opened a folder.
	VaultPath string `json:"vaultPath"`
}

// DefaultSettings is the out-of-the-box configuration.
func DefaultSettings() Settings {
	return Settings{
		Theme:          "dark",
		Accent:         "violet",
		GraphTheme:     "crimson",
		EditorFont:     "serif",
		EditorFontSize: 15.5,
		DefaultView:    "preview",
		AutosaveDelay:  800,
		ConfirmDelete:  true,
		ShowMdExtension: true,
		VaultPath:      "",
	}
}

// sanitize clamps every field to a legal value, falling back to the default
// for anything unknown. Settings arrive from the frontend, so the backend
// never trusts them blindly.
func (s Settings) sanitize() Settings {
	d := DefaultSettings()
	if !oneOf(s.Theme, "dark", "light") {
		s.Theme = d.Theme
	}
	if !oneOf(s.Accent, "violet", "sky", "emerald", "amber", "rose") {
		s.Accent = d.Accent
	}
	if !oneOf(s.GraphTheme, "crimson", "violet", "ocean", "forest", "amber") {
		s.GraphTheme = d.GraphTheme
	}
	if !oneOf(s.EditorFont, "serif", "sans", "mono") {
		s.EditorFont = d.EditorFont
	}
	if s.EditorFontSize < 13 || s.EditorFontSize > 19 {
		s.EditorFontSize = d.EditorFontSize
	}
	if !oneOf(s.DefaultView, "preview", "edit") {
		s.DefaultView = d.DefaultView
	}
	if s.AutosaveDelay < 300 || s.AutosaveDelay > 3000 {
		s.AutosaveDelay = d.AutosaveDelay
	}
	return s
}

func oneOf(v string, opts ...string) bool {
	for _, o := range opts {
		if v == o {
			return true
		}
	}
	return false
}

// GetSettings loads the persisted settings, or returns the defaults when the
// user has never customized anything.
func (s *Store) GetSettings() (Settings, error) {
	d := DefaultSettings()
	var raw string
	err := s.db.QueryRow(
		"SELECT value FROM settings WHERE key = 'app'").Scan(&raw)
	if err != nil {
		if err == sql.ErrNoRows {
			return d, nil
		}
		return d, err
	}
	var sets Settings
	if err := json.Unmarshal([]byte(raw), &sets); err != nil {
		// Corrupt row — start fresh rather than failing the app.
		return d, nil
	}
	// Settings saved before ShowMdExtension existed don't have the field;
	// give them the current default instead of the zero value (false).
	if !strings.Contains(raw, `"showMdExtension"`) {
		sets.ShowMdExtension = d.ShowMdExtension
	}
	return sets.sanitize(), nil
}

// UpdateSettings validates, persists and returns the normalized settings.
func (s *Store) UpdateSettings(sets Settings) (Settings, error) {
	sets = sets.sanitize()
	data, err := json.Marshal(sets)
	if err != nil {
		return sets, err
	}
	_, err = s.db.Exec(
		"INSERT INTO settings (key, value) VALUES ('app', ?) "+
			"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		string(data))
	return sets, err
}

// SetVaultPath remembers the folder opened with "Open folder" so the UI can
// offer to re-open it. Kept in settings so it survives restarts.
func (s *Store) SetVaultPath(path string) error {
	sets, err := s.GetSettings()
	if err != nil {
		return err
	}
	sets.VaultPath = strings.TrimSpace(path)
	_, err = s.UpdateSettings(sets)
	return err
}
