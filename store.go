package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Note is the full record of a note.
type Note struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// NoteSummary is the lightweight record used for lists and search results.
type NoteSummary struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Excerpt   string `json:"excerpt"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// GraphNode is a note rendered as a node in the knowledge graph.
type GraphNode struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	LinkCount int    `json:"linkCount"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// GraphEdge is a resolved bidirectional link between two notes.
type GraphEdge struct {
	Source int64 `json:"source"`
	Target int64 `json:"target"`
}

// GraphData is the full payload for the graph view.
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// LinkInfo describes one wiki-link found inside a note's content.
type LinkInfo struct {
	TargetID    int64  `json:"targetId"`    // 0 when the target note does not exist yet
	TargetTitle string `json:"targetTitle"` // resolved title, or the unresolved target text
	Resolved    bool   `json:"resolved"`
}

// Backlink describes a note that links to the currently open note.
type Backlink struct {
	ID      int64  `json:"id"`
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
}

const schema = `
CREATE TABLE IF NOT EXISTS notes (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	title      TEXT NOT NULL,
	content    TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	from_id           INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	to_id             INTEGER REFERENCES notes(id) ON DELETE CASCADE,
	unresolved_target TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_unresolved ON links(unresolved_target);

-- User preferences (single JSON blob under key 'app').
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- Full-text search index (FTS5). Backed by the notes table via triggers, so
-- the index always mirrors the notes; synced once at startup for databases
-- created before this migration.
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
	title,
	content,
	content='notes',
	content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
	INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
	INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
	INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
`

// Store wraps the SQLite database.
type Store struct {
	db *sql.DB
}

// defaultDBPath returns the path of the notes database, stored in the
// per-user config directory so it survives app reinstalls.
func defaultDBPath() string {
	if p := os.Getenv("SHARKNOTE_DB"); p != "" {
		return p
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	dir = filepath.Join(dir, "sharknote")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return filepath.Join("sharknote.db")
	}
	return filepath.Join(dir, "sharknote.db")
}

// NewStore opens (creating if needed) the SQLite database and runs migrations.
func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite: single writer
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, err
	}
	// FULL durability: every committed transaction is fsynced. Combined with
	// WAL this guards against torn pages when the process is killed
	// mid-write (e.g. by the uninstaller's taskkill during an update).
	if _, err := db.Exec("PRAGMA synchronous = FULL"); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db}
	// Surface database corruption loudly instead of letting writes fail
	// silently later (a corrupted file previously broke note deletion while
	// reads kept working, and the failure was easy to miss).
	s.checkIntegrity()
	s.syncFTS()
	s.purgeSeedProjectNote()
	return s, nil
}

// checkIntegrity runs a quick structural check of the database and logs a
// clear warning if anything is damaged. The store still opens: reads may
// work, and the user can recover their notes instead of losing access.
func (s *Store) checkIntegrity() {
	var result string
	if err := s.db.QueryRow("PRAGMA quick_check").Scan(&result); err != nil {
		log.Printf("WARNING: note database integrity check failed: %v", err)
		return
	}
	if result != "ok" {
		log.Printf("WARNING: note database failed integrity check: %s", result)
	}
}

// syncFTS brings the FTS5 index in line with the notes table. Databases that
// existed before the index was added have no rows in notes_fts, so a rebuild
// populates them (the 'rebuild' command re-reads the external content table).
// Errors are ignored: the LIKE fallback in SearchNotes still works.
func (s *Store) syncFTS() {
	var ftsCount, noteCount int
	if err := s.db.QueryRow("SELECT count(*) FROM notes_fts").Scan(&ftsCount); err != nil {
		return
	}
	if err := s.db.QueryRow("SELECT count(*) FROM notes").Scan(&noteCount); err != nil {
		return
	}
	if ftsCount != noteCount {
		_, _ = s.db.Exec("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')")
	}
}

func (s *Store) Close() error { return s.db.Close() }

func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }

// --- Notes CRUD ------------------------------------------------------------

func scanNote(row interface{ Scan(...any) error }) (*Note, error) {
	var n Note
	if err := row.Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt); err != nil {
		return nil, err
	}
	return &n, nil
}

func (s *Store) GetNote(id int64) (*Note, error) {
	row := s.db.QueryRow("SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?", id)
	n, err := scanNote(row)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("note %d not found", id)
	}
	return n, err
}

// FindByTitle returns the note with the exact given title, or nil if none.
func (s *Store) FindByTitle(title string) (*Note, error) {
	row := s.db.QueryRow("SELECT id, title, content, created_at, updated_at FROM notes WHERE title = ? LIMIT 1", title)
	n, err := scanNote(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return n, err
}

func (s *Store) CreateNote(title, content string) (*Note, error) {
	now := nowISO()
	res, err := s.db.Exec(
		"INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)",
		title, content, now, now,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if err := s.replaceLinks(id, content); err != nil {
		return nil, err
	}
	// The new note may satisfy wiki links that were previously unresolved.
	if err := s.resolvePending(title); err != nil {
		return nil, err
	}
	return s.GetNote(id)
}

func (s *Store) UpdateNote(id int64, title, content string) (*Note, error) {
	oldTitle := ""
	_ = s.db.QueryRow("SELECT title FROM notes WHERE id = ?", id).Scan(&oldTitle)

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		"UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
		title, content, nowISO(), id,
	); err != nil {
		return nil, err
	}
	if err := s.replaceLinksTx(tx, id, content); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	// A rename may have made previously unresolved links point at this note.
	if oldTitle != title {
		if err := s.resolvePending(title); err != nil {
			return nil, err
		}
	}
	return s.GetNote(id)
}

func (s *Store) DeleteNote(id int64) error {
	_, err := s.db.Exec("DELETE FROM notes WHERE id = ?", id)
	return err
}

// RenameNote changes a note's title and rewrites every [[wiki link]] in the
// other notes that pointed at the old title, so backlinks, the graph and the
// literal link text all keep working. Pending (unresolved) links that match
// the new title finally resolve; links whose text pointed at the old title
// are updated to the new one and resolve immediately.
func (s *Store) RenameNote(id int64, newTitle string) (*Note, error) {
	newTitle = strings.TrimSpace(newTitle)
	if newTitle == "" {
		return nil, errors.New("title cannot be empty")
	}
	var oldTitle string
	if err := s.db.QueryRow("SELECT title FROM notes WHERE id = ?", id).Scan(&oldTitle); err != nil {
		return nil, err
	}
	if oldTitle == newTitle {
		return s.GetNote(id)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		"UPDATE notes SET title = ?, updated_at = ? WHERE id = ?",
		newTitle, nowISO(), id,
	); err != nil {
		return nil, err
	}

	// Update the literal [[links]] in every other note and rebuild those
	// notes' link rows so backlinks and the graph reflect the rename.
	rows, err := tx.Query("SELECT id, content FROM notes WHERE id != ?", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var otherID int64
		var content string
		if err := rows.Scan(&otherID, &content); err != nil {
			return nil, err
		}
		rewritten := rewriteWikiTitle(content, oldTitle, newTitle)
		if rewritten == content {
			continue
		}
		if _, err := tx.Exec(
			"UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
			rewritten, nowISO(), otherID,
		); err != nil {
			return nil, err
		}
		if err := s.replaceLinksTx(tx, otherID, rewritten); err != nil {
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Point every still-unresolved link with the old title text at the new
	// title, then resolve them (they now have a matching note).
	if _, err := tx.Exec(
		"UPDATE links SET unresolved_target = ? WHERE unresolved_target IS NOT NULL AND lower(unresolved_target) = lower(?)",
		newTitle, oldTitle,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	if err := s.resolvePending(newTitle); err != nil {
		return nil, err
	}
	return s.GetNote(id)
}

func (s *Store) ListNotes() ([]NoteSummary, error) {
	rows, err := s.db.Query(`
		SELECT id, title, content, created_at, updated_at
		FROM notes ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSummaries(rows)
}

func scanSummaries(rows *sql.Rows) ([]NoteSummary, error) {
	out := []NoteSummary{}
	for rows.Next() {
		var n NoteSummary
		var content string
		if err := rows.Scan(&n.ID, &n.Title, &content, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		n.Excerpt = makeExcerpt(content)
		out = append(out, n)
	}
	return out, rows.Err()
}

// SearchNotes finds notes whose title or content contains the query.
// The FTS5 index is used when possible (ranked by bm25, then recency); if
// the query can't be expressed as FTS syntax it falls back to LIKE.
func (s *Store) SearchNotes(query string) ([]NoteSummary, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return s.ListNotes()
	}
	if ftsQ := buildFTSQuery(q); ftsQ != "" {
		rows, err := s.db.Query(`
			SELECT n.id, n.title, n.content, n.created_at, n.updated_at
			FROM notes_fts f
			JOIN notes n ON n.id = f.rowid
			WHERE notes_fts MATCH ?
			ORDER BY bm25(notes_fts), n.updated_at DESC
			LIMIT 50`, ftsQ)
		if err == nil {
			defer rows.Close()
			return scanSummaries(rows)
		}
		// fall through to LIKE on malformed FTS queries
	}
	return s.searchNotesLike(q)
}

func (s *Store) searchNotesLike(q string) ([]NoteSummary, error) {
	like := "%" + escapeLike(q) + "%"
	prefix := escapeLike(q) + "%"
	rows, err := s.db.Query(`
		SELECT id, title, content, created_at, updated_at
		FROM notes
		WHERE title LIKE ? ESCAPE '\' OR content LIKE ? ESCAPE '\'
		ORDER BY (title LIKE ? ESCAPE '\') DESC, updated_at DESC
		LIMIT 50`, like, like, prefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSummaries(rows)
}

// buildFTSQuery turns a free-text query into safe FTS5 MATCH syntax: every
// word becomes a quoted phrase, joined with AND. All FTS operators are
// neutralized so the query can never be interpreted as an expression.
func buildFTSQuery(q string) string {
	words := strings.Fields(q)
	parts := make([]string, 0, len(words))
	for _, w := range words {
		w = strings.Trim(w, `"'*^:(){}[]!+-~`)
		if w == "" {
			continue
		}
		w = strings.ReplaceAll(w, `"`, `""`) // escape embedded quotes
		parts = append(parts, `"`+w+`"`)
	}
	return strings.Join(parts, " AND ")
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// --- Graph ----------------------------------------------------------------

// GetGraph returns all notes as nodes plus resolved links as edges.
// Edge pairs are deduplicated so each pair of notes is connected once.
func (s *Store) GetGraph() (*GraphData, error) {
	nodes, err := s.graphNodes()
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT from_id, to_id FROM links
		WHERE to_id IS NOT NULL AND from_id != to_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seen := map[[2]int64]bool{}
	edges := []GraphEdge{}
	for rows.Next() {
		var a, b int64
		if err := rows.Scan(&a, &b); err != nil {
			return nil, err
		}
		if a > b {
			a, b = b, a
		}
		key := [2]int64{a, b}
		if seen[key] {
			continue
		}
		seen[key] = true
		edges = append(edges, GraphEdge{Source: a, Target: b})
	}
	return &GraphData{Nodes: nodes, Edges: edges}, rows.Err()
}

func (s *Store) graphNodes() ([]GraphNode, error) {
	rows, err := s.db.Query(`
		SELECT n.id, n.title, n.created_at, n.updated_at,
			(SELECT COUNT(*) FROM links l
			  WHERE (l.from_id = n.id OR l.to_id = n.id) AND l.to_id IS NOT NULL)
		FROM notes n`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GraphNode{}
	for rows.Next() {
		var gn GraphNode
		if err := rows.Scan(&gn.ID, &gn.Title, &gn.CreatedAt, &gn.UpdatedAt, &gn.LinkCount); err != nil {
			return nil, err
		}
		out = append(out, gn)
	}
	return out, rows.Err()
}

// --- Links & backlinks -----------------------------------------------------

// GetOutgoingLinks lists the wiki-links present in a note's content.
func (s *Store) GetOutgoingLinks(id int64) ([]LinkInfo, error) {
	rows, err := s.db.Query(`
		SELECT COALESCE(l.to_id, 0), COALESCE(n.title, l.unresolved_target), l.to_id IS NOT NULL
		FROM links l LEFT JOIN notes n ON n.id = l.to_id
		WHERE l.from_id = ? ORDER BY l.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkInfo{}
	for rows.Next() {
		var li LinkInfo
		if err := rows.Scan(&li.TargetID, &li.TargetTitle, &li.Resolved); err != nil {
			return nil, err
		}
		out = append(out, li)
	}
	return out, rows.Err()
}

// GetBacklinks finds notes that link to the given note, either through a
// resolved link or an unresolved wiki-link whose text matches the title.
func (s *Store) GetBacklinks(id int64) ([]Backlink, error) {
	rows, err := s.db.Query(`
		SELECT DISTINCT n.id, n.title, n.content
		FROM notes n
		JOIN links l ON l.from_id = n.id
		LEFT JOIN notes target ON target.id = l.to_id
		WHERE l.to_id = ? OR lower(COALESCE(target.title, l.unresolved_target)) = (
			SELECT lower(title) FROM notes WHERE id = ?)`,
		id, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Backlink{}
	for rows.Next() {
		var b Backlink
		var content string
		if err := rows.Scan(&b.ID, &b.Title, &content); err != nil {
			return nil, err
		}
		b.Excerpt = backlinkExcerpt(content, id)
		out = append(out, b)
	}
	return out, rows.Err()
}

// --- Helpers ---------------------------------------------------------------

func makeExcerpt(content string) string {
	plain := stripMarkdown(content)
	plain = strings.Join(strings.Fields(plain), " ")
	if len(plain) > 140 {
		plain = plain[:140] + "…"
	}
	return plain
}

// backlinkExcerpt extracts a short snippet of content surrounding the
// wiki-link that points at the given note.
func backlinkExcerpt(content string, noteID int64) string {
	_ = noteID
	// Find the first wiki-link block in the content.
	for _, m := range wikiLinkRE.FindAllStringIndex(content, -1) {
		raw := content[m[0]+2 : m[1]-2] // strip [[ ]]
		raw = strings.TrimSpace(raw)
		if i := strings.IndexAny(raw, "|#"); i >= 0 {
			raw = raw[:i]
		}
		if strings.TrimSpace(raw) == "" {
			continue
		}
		start := m[0] - 60
		if start < 0 {
			start = 0
		}
		end := m[1] + 60
		if end > len(content) {
			end = len(content)
		}
		snippet := stripMarkdown(content[start:end])
		snippet = strings.Join(strings.Fields(snippet), " ")
		if len(snippet) > 120 {
			snippet = snippet[:120] + "…"
		}
		return snippet
	}
	return stripMarkdown(content)
}

// htmlTagRE matches any HTML tag so excerpts read cleanly from rich text notes.
var htmlTagRE = regexp.MustCompile(`<[^>]*>`)

// stripMarkdown removes the most common markdown syntax so excerpts read
// cleanly in the UI. Rich text (HTML) notes get their tags stripped too.
func stripMarkdown(s string) string {
	s = htmlTagRE.ReplaceAllString(s, " ")
	s = wikiLinkRE.ReplaceAllString(s, "$1")
	for _, repl := range []struct{ from, to string }{
		{"**", ""}, {"__", ""}, {"`", ""}, {"~~", ""},
		{"# ", ""}, {"## ", ""}, {"### ", ""}, {"#### ", ""}, {"##### ", ""}, {"###### ", ""},
		{"> ", ""}, {"- ", ""}, {"* ", ""}, {"+ ", ""},
		{"[ ]", "☐"}, {"[x]", "☑"}, {"[X]", "☑"},
	} {
		s = strings.ReplaceAll(s, repl.from, repl.to)
	}
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}
