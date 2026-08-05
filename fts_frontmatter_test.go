package main

import (
	"os"
	"path/filepath"
	"testing"
)

// --- FTS5 search -----------------------------------------------------------

func TestSearchNotesUsesFTS(t *testing.T) {
	s := testStore(t)

	if _, err := s.CreateNote("Go concurrency", "goroutines and channels are fast"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateNote("Python notes", "def hello(): print('hi')"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateNote("Unrelated", "cooking pasta with garlic"); err != nil {
		t.Fatal(err)
	}

	// Exact word match (FTS path)
	res, err := s.SearchNotes("goroutines")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].Title != "Go concurrency" {
		t.Fatalf("want 1 result 'Go concurrency', got %+v", res)
	}

	// Multi-word AND semantics
	res, err = s.SearchNotes("python hello")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].Title != "Python notes" {
		t.Fatalf("want 'Python notes' for 'python hello', got %+v", res)
	}

	// No match
	res, err = s.SearchNotes("zebra")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("want no results for 'zebra', got %+v", res)
	}

	// Operators are neutralized, not executed
	res, err = s.SearchNotes("OR")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("'OR' should be a literal term, got %+v", res)
	}
}

func TestFTSStaysInSync(t *testing.T) {
	s := testStore(t)

	// New store: no notes → counts agree, no rebuild needed
	s.syncFTS()

	n, err := s.CreateNote("Alpha", "searchable payload here")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateNote(n.ID, "Alpha", "updated payload now"); err != nil {
		t.Fatal(err)
	}
	res, err := s.SearchNotes("updated")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 {
		t.Fatalf("want the updated note to be searchable, got %+v", res)
	}
	res, err = s.SearchNotes("here")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("stale FTS row matched old content: %+v", res)
	}
	if err := s.DeleteNote(n.ID); err != nil {
		t.Fatal(err)
	}
	res, err = s.SearchNotes("payload")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("deleted note still searchable: %+v", res)
	}
}

func TestPurgeSeedProjectNote(t *testing.T) {
	s := testStore(t)

	// The exact old seed note (with the tech stack).
	if _, err := s.CreateNote("Project: Sharknote app", seedProjectNoteContent); err != nil {
		t.Fatal(err)
	}
	// A user-edited note with the same title must survive.
	if _, err := s.CreateNote("Project: Sharknote app", "<h1>My project</h1><p>my own content</p>"); err != nil {
		t.Fatal(err)
	}
	// An unrelated note too.
	if _, err := s.CreateNote("Keep me", "<p>hello</p>"); err != nil {
		t.Fatal(err)
	}

	s.purgeSeedProjectNote()

	notes, err := s.ListNotes()
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 2 {
		t.Fatalf("want 2 notes after purge, got %d: %+v", len(notes), notes)
	}
	// The user-edited project note and the unrelated note remain.
	byTitle := map[string]bool{}
	for _, n := range notes {
		byTitle[n.Title] = true
	}
	if !byTitle["Project: Sharknote app"] || !byTitle["Keep me"] {
		t.Fatalf("unexpected survivors: %+v", notes)
	}
	// The tech-stack content must be gone from search too (FTS stays in sync).
	res, err := s.SearchNotes("WebView2")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("tech-stack content still searchable: %+v", res)
	}
}

func TestFTSSyncRebuildsLegacyDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	// Create a database with notes but no FTS index.
	{
		s, err := NewStore(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateNote("Legacy", "old note content"); err != nil {
			t.Fatal(err)
		}
		s.Close()
	}
	// Reopen: the FTS table is created and backfilled by syncFTS.
	s, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var ftsCount int
	if err := s.db.QueryRow("SELECT count(*) FROM notes_fts").Scan(&ftsCount); err != nil {
		t.Fatal(err)
	}
	if ftsCount != 1 {
		t.Fatalf("FTS not backfilled: %d rows", ftsCount)
	}
	res, err := s.SearchNotes("legacy")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].Title != "Legacy" {
		t.Fatalf("want the legacy note searchable, got %+v", res)
	}
}

// --- Frontmatter -----------------------------------------------------------

func TestParseFrontmatter(t *testing.T) {
	cases := []struct {
		name  string
		src   string
		title string
		tags  []string
	}{
		{
			name:  "title only",
			src:   "---\ntitle: My Great Note\n---\nBody text",
			title: "My Great Note",
		},
		{
			name:  "quoted title",
			src:   "---\ntitle: \"A: Quoted Note\"\n---\nBody",
			title: "A: Quoted Note",
		},
		{
			name:  "inline tags",
			src:   "---\ntitle: T\ntags: [go, sqlite, fts5]\n---\nBody",
			title: "T",
			tags:  []string{"go", "sqlite", "fts5"},
		},
		{
			name:  "list tags",
			src:   "---\ntitle: T\ntags:\n  - alpha\n  - beta\n---\nBody",
			title: "T",
			tags:  []string{"alpha", "beta"},
		},
		{
			name:  "no frontmatter",
			src:   "Just a note\n---\nnot frontmatter",
			title: "",
		},
		{
			name:  "frontmatter not at start",
			src:   "Text first\n---\ntitle: T\n---\nBody",
			title: "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fm := parseFrontmatter(c.src)
			if c.title == "" {
				if fm != nil {
					t.Fatalf("want no frontmatter, got %+v", fm)
				}
				return
			}
			if fm == nil {
				t.Fatal("want frontmatter, got nil")
			}
			if fm.Title != c.title {
				t.Fatalf("title: want %q, got %q", c.title, fm.Title)
			}
			if len(fm.Tags) != len(c.tags) {
				t.Fatalf("tags: want %v, got %v", c.tags, fm.Tags)
			}
			for i := range c.tags {
				if fm.Tags[i] != c.tags[i] {
					t.Fatalf("tags: want %v, got %v", c.tags, fm.Tags)
				}
			}
		})
	}
}

func TestImportFileUsesFrontmatterTitle(t *testing.T) {
	s := testStore(t)
	svc := NewNoteService(s)

	dir := t.TempDir()
	path := filepath.Join(dir, "random-filename.md")
	if err := os.WriteFile(path, []byte("---\ntitle: The Real Title\ntags: [imported]\n---\n# Hello\n\nWorld"), 0o644); err != nil {
		t.Fatal(err)
	}

	n, err := svc.ImportFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if n.Title != "The Real Title" {
		t.Fatalf("want frontmatter title, got %q", n.Title)
	}
	// Frontmatter stays in the content (round-trip + searchable)
	if got := n.Content; got != "---\ntitle: The Real Title\ntags: [imported]\n---\n# Hello\n\nWorld" {
		t.Fatalf("content mangled: %q", got)
	}
	// The imported file's tag is searchable through FTS
	res, err := s.SearchNotes("imported")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].Title != "The Real Title" {
		t.Fatalf("want tag search to find the note, got %+v", res)
	}
}
