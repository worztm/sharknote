package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type recNote struct {
	id        int64
	title     string
	content   string
	createdAt string
	updatedAt string
}
type recLink struct {
	id               int64
	fromID           int64
	toID             sql.NullInt64
	unresolvedTarget sql.NullString
}
type recSetting struct {
	key   string
	value string
}

func TestRecoverCorruptDB(t *testing.T) {
	realDB := filepath.Join(os.Getenv("APPDATA"), "sharknote", "sharknote.db")
	work := t.TempDir()
	corrupt := filepath.Join(work, "corrupt.db")
	data, err := os.ReadFile(realDB)
	if err != nil {
		t.Skipf("no real DB: %v", err)
	}
	if err := os.WriteFile(corrupt, data, 0o600); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", corrupt)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// How bad is the damage?
	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		t.Logf("integrity_check errored: %v", err)
	} else {
		t.Logf("integrity_check: %s", integrity)
	}

	// 1. Dump everything readable.
	var notes []recNote
	rows, err := db.Query("SELECT id, title, content, created_at, updated_at FROM notes")
	if err != nil {
		t.Fatalf("notes dump failed: %v", err)
	}
	for rows.Next() {
		var n recNote
		if err := rows.Scan(&n.id, &n.title, &n.content, &n.createdAt, &n.updatedAt); err != nil {
			t.Fatalf("note row scan failed: %v", err)
		}
		notes = append(notes, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("notes iteration failed: %v", err)
	}
	t.Logf("dumped %d notes", len(notes))

	var links []recLink
	rows, err = db.Query("SELECT id, from_id, to_id, unresolved_target FROM links")
	if err == nil {
		for rows.Next() {
			var l recLink
			if err := rows.Scan(&l.id, &l.fromID, &l.toID, &l.unresolvedTarget); err != nil {
				t.Fatalf("link row scan failed: %v", err)
			}
			links = append(links, l)
		}
		rows.Close()
		t.Logf("dumped %d links", len(links))
	} else {
		t.Logf("links dump failed (continuing): %v", err)
	}

	var settings []recSetting
	rows, err = db.Query("SELECT key, value FROM settings")
	if err == nil {
		for rows.Next() {
			var s recSetting
			if err := rows.Scan(&s.key, &s.value); err != nil {
				t.Fatalf("setting scan failed: %v", err)
			}
			settings = append(settings, s)
		}
		rows.Close()
		t.Logf("dumped %d settings", len(settings))
	} else {
		t.Logf("settings dump failed (continuing): %v", err)
	}

	// 2. Rebuild a fresh DB with the same schema.
	clean := filepath.Join(work, "clean.db")
	ndb, err := sql.Open("sqlite", clean)
	if err != nil {
		t.Fatal(err)
	}
	defer ndb.Close()
	ndb.SetMaxOpenConns(1)
	if _, err := ndb.Exec("PRAGMA foreign_keys = ON"); err != nil {
		t.Fatal(err)
	}
	if _, err := ndb.Exec("PRAGMA journal_mode = WAL"); err != nil {
		t.Fatal(err)
	}
	if _, err := ndb.Exec(schema); err != nil {
		t.Fatal(err)
	}

	// 3. Re-insert with original IDs (keeps links valid, bumps AUTOINCREMENT).
	tx, err := ndb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range notes {
		if _, err := tx.Exec("INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)",
			n.id, n.title, n.content, n.createdAt, n.updatedAt); err != nil {
			t.Fatalf("reinsert note %d failed: %v", n.id, err)
		}
	}
	for _, l := range links {
		if _, err := tx.Exec("INSERT INTO links (id, from_id, to_id, unresolved_target) VALUES (?,?,?,?)",
			l.id, l.fromID, l.toID, l.unresolvedTarget); err != nil {
			t.Fatalf("reinsert link %d failed: %v", l.id, err)
		}
	}
	for _, s := range settings {
		if _, err := tx.Exec("INSERT INTO settings (key, value) VALUES (?,?)", s.key, s.value); err != nil {
			t.Fatalf("reinsert setting %q failed: %v", s.key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// 4. Rebuild the FTS index from the notes table.
	if _, err := ndb.Exec("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')"); err != nil {
		t.Fatalf("fts rebuild failed: %v", err)
	}

	// 5. Verify the clean DB: integrity + a write (delete) round-trip.
	var cleanIntegrity string
	if err := ndb.QueryRow("PRAGMA integrity_check").Scan(&cleanIntegrity); err != nil {
		t.Fatalf("clean integrity_check errored: %v", err)
	}
	t.Logf("clean integrity_check: %s", cleanIntegrity)
	if cleanIntegrity != "ok" {
		t.Fatalf("recovered DB is not healthy: %s", cleanIntegrity)
	}

	var ftsCount, noteCount int
	ndb.QueryRow("SELECT count(*) FROM notes_fts").Scan(&ftsCount)
	ndb.QueryRow("SELECT count(*) FROM notes").Scan(&noteCount)
	t.Logf("fts rows %d / notes %d", ftsCount, noteCount)

	store := &Store{db: ndb}
	if err := store.DeleteNote(notes[0].id); err != nil {
		t.Fatalf("delete on recovered DB failed: %v", err)
	}
	var n int
	ndb.QueryRow("SELECT count(*) FROM notes").Scan(&n)
	if n != len(notes)-1 {
		t.Fatalf("expected %d notes after delete, got %d", len(notes)-1, n)
	}
	t.Logf("delete works on recovered DB ✓ (%d → %d notes)", len(notes), n)

	// Copy the recovered DB to a known location for manual inspection.
	_ = os.MkdirAll(filepath.Join(os.Getenv("APPDATA"), "sharknote", "recovered-test"), 0o755)
	_ = os.Remove(filepath.Join(os.Getenv("APPDATA"), "sharknote", "recovered-test", "clean.db"))
	out, _ := os.ReadFile(clean)
	if err := os.WriteFile(filepath.Join(os.Getenv("APPDATA"), "sharknote", "recovered-test", "clean.db"), out, 0o600); err != nil {
		t.Logf("note: could not copy clean DB for inspection: %v", err)
	}
	t.Logf("recovery OK — %d notes, %d links, %d settings preserved", len(notes), len(links), len(settings))
	_ = fmt.Sprintf
}
