package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaultsAndRoundTrip(t *testing.T) {
	s := testStore(t)

	// Never customized → defaults.
	got, err := s.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != "dark" || got.Accent != "violet" || got.GraphTheme != "crimson" {
		t.Fatalf("unexpected defaults: %+v", got)
	}
	if got.EditorFontSize != 15.5 || got.AutosaveDelay != 800 || !got.ConfirmDelete {
		t.Fatalf("unexpected defaults: %+v", got)
	}
	if !got.ShowMdExtension {
		t.Fatalf("ShowMdExtension should default to true: %+v", got)
	}

	// Round-trip a customization.
	want := DefaultSettings()
	want.Theme = "light"
	want.Accent = "emerald"
	want.GraphTheme = "ocean"
	want.EditorFont = "mono"
	want.EditorFontSize = 17
	want.DefaultView = "edit"
	want.AutosaveDelay = 1500
	want.ConfirmDelete = false
	want.ShowMdExtension = false
	want.VaultPath = `C:\notes`
	saved, err := s.UpdateSettings(want)
	if err != nil {
		t.Fatal(err)
	}
	got, err = s.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got != saved || got != want {
		t.Fatalf("settings did not round-trip: %+v vs %+v", got, want)
	}
}

// Settings rows saved before ShowMdExtension existed (the JSON has no such
// field) must fall back to the current default instead of the zero value.
func TestSettingsLegacyRowGetsShowMdExtensionDefault(t *testing.T) {
	s := testStore(t)
	legacy := `{"theme":"dark","accent":"violet","graphTheme":"crimson","editorFont":"serif","editorFontSize":15.5,"defaultView":"preview","autosaveDelay":800,"confirmDelete":true,"vaultPath":""}`
	if _, err := s.db.Exec("INSERT INTO settings (key, value) VALUES ('app', ?)", legacy); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if !got.ShowMdExtension {
		t.Fatalf("legacy settings row must inherit ShowMdExtension=true, got %+v", got)
	}

	// Once the user explicitly saves the field, their choice sticks.
	if _, err := s.UpdateSettings(DefaultSettings()); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if !got.ShowMdExtension {
		t.Fatalf("default round-trip must keep ShowMdExtension=true: %+v", got)
	}
}

func TestSettingsSanitize(t *testing.T) {
	s := testStore(t)

	bad := DefaultSettings()
	bad.Theme = "neon"
	bad.Accent = "rainbow"
	bad.GraphTheme = "hologram"
	bad.EditorFont = "comic"
	bad.EditorFontSize = 999
	bad.DefaultView = "zen"
	bad.AutosaveDelay = -5
	got, err := s.UpdateSettings(bad)
	if err != nil {
		t.Fatal(err)
	}
	d := DefaultSettings()
	if got.Theme != d.Theme || got.Accent != d.Accent || got.GraphTheme != d.GraphTheme {
		t.Fatalf("invalid values must fall back to defaults: %+v", got)
	}
	if got.EditorFont != d.EditorFont || got.EditorFontSize != d.EditorFontSize {
		t.Fatalf("invalid values must fall back to defaults: %+v", got)
	}
	if got.DefaultView != d.DefaultView || got.AutosaveDelay != d.AutosaveDelay {
		t.Fatalf("invalid values must fall back to defaults: %+v", got)
	}
}

func TestImportFolder(t *testing.T) {
	s := testStore(t)
	svc := NewNoteService(s)

	dir := t.TempDir()
	files := []string{
		"a.md",          // plain markdown
		"b note.md",     // filename with spaces
		"c.md",          // with frontmatter title
		"sub/d.md",      // nested
		"sub/deep/e.md", // deeply nested
		"ignored.txt",   // not markdown
		".git/x.md",     // hidden folder — must be skipped
		".obsidian/y.md",
	}
	for _, f := range files {
		p := filepath.Join(dir, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fm := filepath.Join(dir, "c.md")
	if err := os.WriteFile(fm, []byte("---\ntitle: Custom title\n---\nbody"), 0o644); err != nil {
		t.Fatal(err)
	}

	ids, err := svc.ImportFolder(dir)
	if err != nil {
		t.Fatal(err)
	}
	// a, b note, c (Custom title), d, e — hidden dirs and .txt excluded.
	if len(ids) != 5 {
		t.Fatalf("want 5 imported notes, got %d (%v)", len(ids), ids)
	}

	notes, err := s.ListNotes()
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]bool{}
	for _, n := range notes {
		titles[n.Title] = true
	}
	for _, want := range []string{"a", "b note", "Custom title", "d", "e"} {
		if !titles[want] {
			t.Fatalf("missing imported note %q (have %v)", want, titles)
		}
	}
	if titles[".git"] || titles[".obsidian"] {
		t.Fatal("hidden folders must not be imported")
	}

	// Re-importing the same folder updates instead of duplicating.
	ids2, err := svc.ImportFolder(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids2) != 5 {
		t.Fatalf("re-import should return 5 ids, got %d", len(ids2))
	}
	all, err := s.ListNotes()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 5 {
		t.Fatalf("re-import must not duplicate notes, got %d", len(all))
	}
}

func TestVaultPathPersisted(t *testing.T) {
	s := testStore(t)
	dir := t.TempDir()
	if err := s.SetVaultPath(dir); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got.VaultPath != dir {
		t.Fatalf("vault path not persisted: %q", got.VaultPath)
	}
}
