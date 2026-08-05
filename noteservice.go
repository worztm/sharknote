package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NoteService exposes the note store to the frontend through Wails bindings.
type NoteService struct {
	store *Store

	// pendingOpenedNoteID holds the id of a note imported from a .md file
	// opened via the OS file association, so the frontend can pick it up
	// after it finishes loading (the open event may fire before the UI is up).
	pendingMu          sync.Mutex
	pendingOpenedNoteID int64
}

func NewNoteService(store *Store) *NoteService {
	return &NoteService{store: store}
}

// ListNotes returns all notes, most recently updated first.
func (s *NoteService) ListNotes() ([]NoteSummary, error) {
	return s.store.ListNotes()
}

// GetNote returns the full record of a single note.
func (s *NoteService) GetNote(id int64) (*Note, error) {
	return s.store.GetNote(id)
}

// CreateNote creates a note with the given title and content.
func (s *NoteService) CreateNote(title, content string) (*Note, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Untitled"
	}
	return s.store.CreateNote(title, content)
}

// UpdateNote saves the title and content of a note, re-scanning its wiki links.
func (s *NoteService) UpdateNote(id int64, title, content string) (*Note, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Untitled"
	}
	return s.store.UpdateNote(id, title, content)
}

// DeleteNote permanently removes a note and all links pointing to or from it.
func (s *NoteService) DeleteNote(id int64) error {
	return s.store.DeleteNote(id)
}

// SearchNotes returns notes whose title or content matches the query.
func (s *NoteService) SearchNotes(query string) ([]NoteSummary, error) {
	return s.store.SearchNotes(query)
}

// GetGraph returns every note as a node and every resolved link as an edge.
func (s *NoteService) GetGraph() (*GraphData, error) {
	return s.store.GetGraph()
}

// ImportFile reads a markdown file from disk and stores it as a note. The
// note is named after the YAML frontmatter `title` when the file has one,
// otherwise after the filename (without extension). If a note with that title
// already exists its content is replaced, so re-opening the same file never
// creates duplicates.
func (s *NoteService) ImportFile(path string) (*Note, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return s.importContent(path, string(content))
}

// importContent stores already-read file content as a note, reusing the
// ImportFile title/dedup rules. Imported files keep their raw markdown; the
// editor migrates it to rich text on first open.
func (s *NoteService) importContent(path, source string) (*Note, error) {
	title := ""
	if fm := parseFrontmatter(source); fm != nil && fm.Title != "" {
		title = fm.Title
	} else {
		title = strings.TrimSpace(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	}
	if title == "" {
		title = "Untitled"
	}
	if existing, err := s.store.FindByTitle(title); err != nil {
		return nil, err
	} else if existing != nil {
		return s.store.UpdateNote(existing.ID, title, source)
	}
	return s.store.CreateNote(title, source)
}

// ImportFiles imports a list of markdown files, returning the ids of the
// notes that were created or updated (in the same order as the input).
func (s *NoteService) ImportFiles(paths []string) ([]int64, error) {
	ids := make([]int64, 0, len(paths))
	for _, p := range paths {
		note, err := s.ImportFile(p)
		if err != nil {
			return ids, err
		}
		ids = append(ids, note.ID)
	}
	return ids, nil
}

// ImportFolder imports every .md file under dir (recursively, skipping
// hidden folders like .git and .obsidian), sorted by path for stable
// ordering. Returns the ids of all imported notes.
func (s *NoteService) ImportFolder(dir string) ([]int64, error) {
	var files []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			// Skip hidden/plugin folders — vaults like Obsidian keep their
			// config in .obsidian and version control in .git.
			if path != dir && strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.EqualFold(filepath.Ext(d.Name()), ".md") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return s.ImportFiles(files)
}

// OpenFiles shows a native multi-select dialog for markdown files, imports
// the picked files, and returns the ids of the notes that were created or
// updated. Returns nil when the user cancels.
func (s *NoteService) OpenFiles() ([]int64, error) {
	app := application.Get()
	if app == nil {
		return nil, errors.New("application not available")
	}
	var owner uintptr
	if w := app.Window.Current(); w != nil {
		owner = uintptr(w.NativeWindow())
	}
	paths, err := showOpenFilesDialog(owner, "Open markdown files")
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, nil // user cancelled
	}
	return s.ImportFiles(paths)
}

// OpenFolderDialog shows a native folder picker, imports every markdown file
// inside it, and remembers the folder as the current vault. Used from the
// "Open folder" button and the Settings dialog to pick the vault path.
func (s *NoteService) OpenFolderDialog() ([]int64, error) {
	app := application.Get()
	if app == nil {
		return nil, errors.New("application not available")
	}
	var owner uintptr
	if w := app.Window.Current(); w != nil {
		owner = uintptr(w.NativeWindow())
	}
	dirs, err := showOpenFolderDialog(owner, "Open folder (import vault)")
	if err != nil {
		return nil, err
	}
	if len(dirs) == 0 {
		return nil, nil // user cancelled
	}
	ids, err := s.ImportFolder(dirs[0])
	if err != nil {
		return nil, err
	}
	_ = s.store.SetVaultPath(dirs[0])
	return ids, nil
}

// GetSettings returns the persisted user preferences.
func (s *NoteService) GetSettings() (Settings, error) {
	return s.store.GetSettings()
}

// UpdateSettings validates and persists the user preferences.
func (s *NoteService) UpdateSettings(settings Settings) (Settings, error) {
	return s.store.UpdateSettings(settings)
}

// SetPendingOpenedNote records a note id for the frontend to open on load.
func (s *NoteService) SetPendingOpenedNote(id int64) {
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	s.pendingOpenedNoteID = id
}

// TakePendingOpenedNote returns the pending opened-note id (if any) and
// clears it. Called by the frontend after initial load.
func (s *NoteService) TakePendingOpenedNote() int64 {
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	id := s.pendingOpenedNoteID
	s.pendingOpenedNoteID = 0
	return id
}

// GetOutgoingLinks lists the wiki links written inside a note.
func (s *NoteService) GetOutgoingLinks(id int64) ([]LinkInfo, error) {
	return s.store.GetOutgoingLinks(id)
}

// GetBacklinks lists the notes that link to a given note.
func (s *NoteService) GetBacklinks(id int64) ([]Backlink, error) {
	return s.store.GetBacklinks(id)
}
