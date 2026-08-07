package main

import (
	"database/sql"
	"log"
	"regexp"
	"strings"
)

// wikiLinkRE matches Obsidian-style [[wiki links]] in note content,
// including aliases ([[Target|alias]]) and section anchors ([[Target#Section]]).
var wikiLinkRE = regexp.MustCompile(`\[\[([^\[\]]+)\]\]`)

// parsedLink is a single wiki-link found in a note's content.
type parsedLink struct {
	target string // note title the link points at (alias/section stripped)
	alias  string // display text, empty when no alias is given
}

// parseWikiLinks extracts all wiki links from markdown content.
func parseWikiLinks(content string) []parsedLink {
	matches := wikiLinkRE.FindAllStringSubmatch(content, -1)
	out := make([]parsedLink, 0, len(matches))
	seen := map[string]bool{}
	for _, m := range matches {
		inner := strings.TrimSpace(m[1])
		alias := ""
		if i := strings.Index(inner, "|"); i >= 0 {
			alias = strings.TrimSpace(inner[i+1:])
			inner = strings.TrimSpace(inner[:i])
		}
		// Strip section anchors: [[Note#Section]] links to the note itself.
		if i := strings.Index(inner, "#"); i >= 0 {
			inner = strings.TrimSpace(inner[:i])
		}
		if inner == "" {
			continue
		}
		if alias == "" {
			alias = inner
		}
		key := strings.ToLower(inner)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, parsedLink{target: inner, alias: alias})
	}
	return out
}

// rewriteWikiTitle changes every [[wiki link]] in a note that points at the
// given title to point at newTitle instead, preserving any alias and section
// parts: [[Old Title]] → [[New Title]], [[Old Title|alias]] → [[New Title|alias]],
// [[Old Title#Section]] → [[New Title#Section]]. Matching is case-insensitive
// like link resolution. It runs on the literal note content (rich text HTML),
// so links split across HTML tags are left alone.
func rewriteWikiTitle(content, oldTitle, newTitle string) string {
	if oldTitle == newTitle || content == "" {
		return content
	}
	var out strings.Builder
	out.Grow(len(content) + 16)
	last := 0
	changed := false
	for _, m := range wikiLinkRE.FindAllStringSubmatchIndex(content, -1) {
		inner := content[m[2]:m[3]]
		t := strings.TrimSpace(inner)
		// The target ends at the first alias (|) or section (#) separator.
		sep := len(t)
		if i := strings.Index(t, "|"); i >= 0 && i < sep {
			sep = i
		}
		if i := strings.Index(t, "#"); i >= 0 && i < sep {
			sep = i
		}
		target := strings.TrimSpace(t[:sep])
		if strings.EqualFold(target, oldTitle) {
			out.WriteString(content[last:m[0]])
			out.WriteString("[[" + newTitle)
			out.WriteString(t[sep:])
			out.WriteString("]]")
			last = m[1]
			changed = true
		}
	}
	if !changed {
		return content
	}
	out.WriteString(content[last:])
	return out.String()
}

// replaceLinks rewrites the link table for a note based on its content.
func (s *Store) replaceLinks(noteID int64, content string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := s.replaceLinksTx(tx, noteID, content); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) replaceLinksTx(tx *sql.Tx, noteID int64, content string) error {
	if _, err := tx.Exec("DELETE FROM links WHERE from_id = ?", noteID); err != nil {
		return err
	}
	for _, link := range parseWikiLinks(content) {
		// Resolve the target: exact title match first, then case-insensitive.
		var toID int64
		err := tx.QueryRow(
			"SELECT id FROM notes WHERE title = ? LIMIT 1", link.target,
		).Scan(&toID)
		if err == sql.ErrNoRows {
			err = tx.QueryRow(
				"SELECT id FROM notes WHERE title = ? COLLATE NOCASE LIMIT 1", link.target,
			).Scan(&toID)
		}
		switch {
		case err == nil:
			_, err = tx.Exec(
				"INSERT INTO links (from_id, to_id) VALUES (?, ?)", noteID, toID)
		case err == sql.ErrNoRows:
			_, err = tx.Exec(
				"INSERT INTO links (from_id, unresolved_target) VALUES (?, ?)", noteID, link.target)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// resolvePending points every unresolved link whose text matches the given
// title at the corresponding note. Called when a note is created or renamed.
func (s *Store) resolvePending(title string) error {
	_, err := s.db.Exec(`
		UPDATE links SET
			to_id = (SELECT id FROM notes WHERE title = ? COLLATE NOCASE LIMIT 1),
			unresolved_target = NULL
		WHERE lower(unresolved_target) = lower(?)`,
		title, title)
	return err
}

// resolveTarget looks up the note id for a wiki-link target string.
// Returns 0 when no note matches.
func (s *Store) resolveTarget(target string) (int64, error) {
	var id int64
	err := s.db.QueryRow(
		"SELECT id FROM notes WHERE title = ? COLLATE NOCASE LIMIT 1", target,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

// seedNote is one of the default notes created on first run.
type seedNote struct {
	title   string
	content string
}

// seedProjectNoteContent is the exact content of the "Project: Sharknote app"
// note that used to be part of the seed set. It was removed because it
// revealed the app's tech stack. The purge below still removes this exact
// note from databases created before the removal.
const seedProjectNoteContent = `<h1>Project: Sharknote app</h1>
<p>Building Sharknote — a beautiful desktop notes app with a knowledge graph.</p>
<h2>Stack</h2>
<ul>
<li>Wails v3 — Go + WebView2 shell</li>
<li>React + TypeScript — UI</li>
<li>SQLite — storage</li>
<li>d3-force — graph layout</li>
</ul>
<h2>Status</h2>
<ul>
<li>Done: Notes CRUD</li>
<li>Done: [[Bidirectional links]]</li>
<li>Done: [[Graph view]]</li>
<li>Done: [[Rich text]] editing</li>
<li>Todo: Mobile companion</li>
</ul>
<p>Ship it. 🚀</p>`

// purgeSeedProjectNote deletes the old tech-stack seed note from databases
// that already contain it. The content must match exactly, so a user's own
// note that happens to share the title is never touched.
func (s *Store) purgeSeedProjectNote() {
	_, err := s.db.Exec(
		"DELETE FROM notes WHERE title = ? AND content = ?",
		"Project: Sharknote app", seedProjectNoteContent,
	)
	if err != nil {
		log.Printf("warning: failed to purge old seed note: %v", err)
	}
}

// Seed populates the database with a small set of linked notes on first run
// so the knowledge graph and bidirectional links are immediately visible.
// Seed notes are rich text (HTML) with [[wiki links]] kept as literal text so
// backlinks and the graph keep working. No markdown markers (##, **, ...).
func (s *Store) Seed() error {
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM notes").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	seed := []seedNote{
		{
			title: "Welcome to Sharknote",
			content: `<h1>Welcome to Sharknote 🦈</h1>
<p>This is your new networked note-taking space. Notes live here like thoughts — connected, not filed.</p>
<h2>Try it right now</h2>
<ul>
<li>Type [[ anywhere in a note to link to another note — try linking to [[Graph view]].</li>
<li>Click a link in the preview to jump between notes.</li>
<li>Open the graph view (shortcut Ctrl+G) to see how your notes form a knowledge map.</li>
</ul>
<h2>The idea</h2>
<p>Every note you write becomes a node. Every [[wiki link]] becomes an edge. Over time your vault grows into a second brain — a web of your own thinking.</p>
<blockquote><p>Start by opening [[Bidirectional links]] to learn how links work in both directions.</p></blockquote>`,
		},
		{
			title: "Bidirectional links",
			content: `<h1>Bidirectional links</h1>
<p>A bidirectional link knows about itself in reverse.</p>
<p>When note A links to note B with [[B]], note B automatically shows note A in its backlinks panel. Connections work in both directions — nothing gets lost.</p>
<h2>In Sharknote</h2>
<ul>
<li>Outgoing links — the [[links]] written inside the current note.</li>
<li>Backlinks — every note that links to the current note, with a context snippet.</li>
</ul>
<p>Links can be unresolved: if you write [[Some future idea]] before the note exists, Sharknote keeps the link alive. Create the note later and the link resolves automatically.</p>
<p>Related: [[Zettelkasten method]], [[Graph view]]</p>`,
		},
		{
			title: "Graph view",
			content: `<h1>Graph view</h1>
<p>The graph view renders your entire vault as a knowledge map.</p>
<ul>
<li>Each node is a note — bigger nodes have more connections.</li>
<li>Each edge is a [[wiki link]] between notes.</li>
<li>Drag nodes, scroll to zoom, click to open a note.</li>
<li>Hover a node to highlight everything it touches.</li>
</ul>
<p>Open it anytime with Ctrl+G or the button in the sidebar.</p>
<p>Related: [[Bidirectional links]], [[Rich text]]</p>`,
		},
		{
			title: "Rich text",
			content: `<h1>Rich text</h1>
<p>Notes are rich text — format them just like a document editor.</p>
<h2>Formatting guide</h2>
<ul>
<li>Select text, then right-click to change its color, font (try Times New Roman) or size.</li>
<li>Use the alignment options to move a paragraph left, center or right.</li>
<li>Bold, italic and underline are available from the right-click menu or Ctrl+B / Ctrl+I / Ctrl+U.</li>
</ul>
<p>Toggle edit / preview with Ctrl+E.</p>
<p>Related: [[Welcome to Sharknote]], [[Idea vault]]</p>`,
		},
		{
			title: "Idea vault",
			content: `<h1>Idea vault</h1>
<p>A place for half-formed thoughts that deserve a home.</p>
<p>The vault only grows when capture is effortless. That's why Sharknote lives in your system tray of ideas — write fast, link often, structure rarely.</p>
<p>[[Zettelkasten method]] is a great place to start.</p>`,
		},
		{
			title: "Zettelkasten method",
			content: `<h1>Zettelkasten method</h1>
<p>The Zettelkasten ("slip box") is a personal knowledge management method:</p>
<ol>
<li>Write one idea per note, in your own words.</li>
<li>Link every note to related notes.</li>
<li>Follow links to discover unexpected connections.</li>
</ol>
<p>The magic happens in step 2 — which is exactly what [[Bidirectional links]] are for.</p>
<p>See also: [[Idea vault]]</p>`,
		},
		{
			title: "Reading list",
			content: `<h1>Reading list</h1>
<p>Books and articles worth my attention:</p>
<ul>
<li>How to Take Smart Notes — Sönke Ahrens</li>
<li>A Philosophy of Software Design — John Ousterhout</li>
<li>The Extended Mind — Annie Murphy Paul</li>
</ul>
<p>Collect ideas from each read into the [[Idea vault]] so they can meet each other.</p>`,
		},
	}
	for _, n := range seed {
		now := nowISO()
		res, err := s.db.Exec(
			"INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)",
			n.title, n.content, now, now,
		)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		if err := s.replaceLinks(id, n.content); err != nil {
			return err
		}
	}

	// All seed notes now exist — resolve every link that was still pending
	// because its target note had not been created yet. Links whose target
	// matches no note stay unresolved.
	if _, err := s.db.Exec(`
		UPDATE links SET
			to_id = (SELECT id FROM notes
				WHERE title = links.unresolved_target COLLATE NOCASE LIMIT 1),
			unresolved_target = NULL
		WHERE unresolved_target IS NOT NULL
			AND EXISTS (SELECT 1 FROM notes
				WHERE title = links.unresolved_target COLLATE NOCASE)`); err != nil {
		return err
	}
	return nil
}
