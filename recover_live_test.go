package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// RecoverLiveDB rebuilds the user's corrupt notes database from its readable
// contents. Safe to run only when the app is NOT running. Keeps a backup of
// the corrupt original (sharknote.db.corrupt-<date>.bak). Prints
// "RECOVERY SWAP OK" on success. Invoked as a standalone go test.
func RecoverLiveDB() error {
	dir := filepath.Join(os.Getenv("APPDATA"), "sharknote")
	realDB := filepath.Join(dir, "sharknote.db")
	work := filepath.Join(dir, "recovery-work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(work)
	recovered := filepath.Join(work, "recovered.db")

	// ---- 1. Read everything from the live (corrupt) DB ----
	src, err := sql.Open("sqlite", realDB)
	if err != nil {
		return err
	}
	defer src.Close()
	src.SetMaxOpenConns(1)

	rows, err := src.Query("SELECT id, title, content, created_at, updated_at FROM notes ORDER BY id")
	if err != nil {
		return fmt.Errorf("dump notes: %w", err)
	}
	type note struct{ id int64; title, content, ca, ua string }
	var notes []note
	for rows.Next() {
		var n note
		if err := rows.Scan(&n.id, &n.title, &n.content, &n.ca, &n.ua); err != nil {
			rows.Close()
			return fmt.Errorf("scan note: %w", err)
		}
		notes = append(notes, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	fmt.Printf("dumped %d notes\n", len(notes))

	type link struct{ id, fromID int64; toID sql.NullInt64; ut sql.NullString }
	var links []link
	rows, err = src.Query("SELECT id, from_id, to_id, unresolved_target FROM links ORDER BY id")
	if err == nil {
		for rows.Next() {
			var l link
			if err := rows.Scan(&l.id, &l.fromID, &l.toID, &l.ut); err != nil {
				rows.Close()
				return fmt.Errorf("scan link: %w", err)
			}
			links = append(links, l)
		}
		rows.Close()
	}
	fmt.Printf("dumped %d links\n", len(links))

	type setting struct{ k, v string }
	var settings []setting
	rows, err = src.Query("SELECT key, value FROM settings")
	if err == nil {
		for rows.Next() {
			var s setting
			if err := rows.Scan(&s.k, &s.v); err != nil {
				rows.Close()
				return fmt.Errorf("scan setting: %w", err)
			}
			settings = append(settings, s)
		}
		rows.Close()
	}
	fmt.Printf("dumped %d settings\n", len(settings))

	if len(notes) == 0 {
		return fmt.Errorf("no notes to recover")
	}

	// ---- 2. Build a fresh DB (rollback journal so everything lands in the
	// main file; no WAL shadow). ----
	dst, err := sql.Open("sqlite", recovered)
	if err != nil {
		return err
	}
	dst.SetMaxOpenConns(1)
	if _, err := dst.Exec("PRAGMA journal_mode = DELETE"); err != nil {
		return err
	}
	if _, err := dst.Exec("PRAGMA synchronous = FULL"); err != nil {
		return err
	}
	if _, err := dst.Exec(schema); err != nil {
		return err
	}

	tx, err := dst.Begin()
	if err != nil {
		return err
	}
	for _, n := range notes {
		if _, err := tx.Exec("INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)",
			n.id, n.title, n.content, n.ca, n.ua); err != nil {
			return fmt.Errorf("reinsert note %d: %w", n.id, err)
		}
	}
	for _, l := range links {
		if _, err := tx.Exec("INSERT INTO links (id, from_id, to_id, unresolved_target) VALUES (?,?,?,?)",
			l.id, l.fromID, l.toID, l.ut); err != nil {
			return fmt.Errorf("reinsert link %d: %w", l.id, err)
		}
	}
	for _, s := range settings {
		if _, err := tx.Exec("INSERT INTO settings (key, value) VALUES (?,?)", s.k, s.v); err != nil {
			return fmt.Errorf("reinsert setting: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if _, err := dst.Exec("INSERT INTO notes_fts(notes_fts) VALUES ('rebuild')"); err != nil {
		return err
	}

	var maxID int64
	if err := dst.QueryRow("SELECT COALESCE(MAX(id),0) FROM notes").Scan(&maxID); err != nil {
		return err
	}
	var seq int64
	if err := dst.QueryRow("SELECT seq FROM sqlite_sequence WHERE name='notes'").Scan(&seq); err != nil {
		return err
	}
	if seq != maxID {
		return fmt.Errorf("sqlite_sequence %d != max id %d", seq, maxID)
	}
	if err := dst.Close(); err != nil {
		return err
	}

	// ---- 3. Verify a COPY destructively (never the artifact itself) ----
	verify := filepath.Join(work, "verify.db")
	vbytes, err := os.ReadFile(recovered)
	if err != nil {
		return err
	}
	if err := os.WriteFile(verify, vbytes, 0o600); err != nil {
		return err
	}
	v, err := sql.Open("sqlite", verify)
	if err != nil {
		return err
	}
	v.SetMaxOpenConns(1)
	if _, err := v.Exec("PRAGMA journal_mode = WAL"); err != nil {
		return err
	}
	var ic string
	if err := v.QueryRow("PRAGMA integrity_check").Scan(&ic); err != nil {
		return err
	}
	if ic != "ok" {
		return fmt.Errorf("integrity_check = %s", ic)
	}
	if _, err := v.Exec("DELETE FROM notes WHERE id = 10"); err != nil { // the once-broken note
		return fmt.Errorf("delete formerly-broken note id=10 still fails: %w", err)
	}
	if _, err := v.Exec("INSERT INTO notes (title, content, created_at, updated_at) VALUES ('recovery-probe', '', ?, ?)",
		time.Now().UTC().Format(time.RFC3339), time.Now().UTC().Format(time.RFC3339)); err != nil {
		return err
	}
	var newID int64
	if err := v.QueryRow("SELECT id FROM notes WHERE title='recovery-probe'").Scan(&newID); err != nil {
		return err
	}
	if newID <= maxID {
		return fmt.Errorf("new note id %d collides (max %d)", newID, maxID)
	}
	if _, err := v.Exec("DELETE FROM notes WHERE title='recovery-probe'"); err != nil {
		return err
	}
	v.Close()
	fmt.Printf("verify OK: delete id=10 works, fresh ids continue at %d+\n", maxID+1)

	// ---- 4. Backup the corrupt original, then swap in the recovered DB. ----
	backup := filepath.Join(dir, "sharknote.db.corrupt-"+time.Now().Format("20060102-150405")+".bak")
	original, err := os.ReadFile(realDB)
	if err != nil {
		return err
	}
	if err := os.WriteFile(backup, original, 0o600); err != nil {
		return err
	}
	fmt.Printf("backup of corrupt DB kept at %s\n", backup)

	// Also drop any stale WAL/SHM that would confuse the swap.
	_ = os.Remove(realDB + "-wal")
	_ = os.Remove(realDB + "-shm")

	if err := os.WriteFile(realDB, vbytes, 0o600); err != nil {
		return err
	}
	fmt.Printf("RECOVERY SWAP OK — wrote %d notes to %s\n", len(notes), realDB)
	return nil
}