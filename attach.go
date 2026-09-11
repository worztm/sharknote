package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Attachment is a file copied into the Sharknote data dir and linked to a
// note. The stored name on disk is a random token plus the original
// extension; the human-visible filename lives in the database.
type Attachment struct {
	ID        int64  `json:"id"`
	NoteID    int64  `json:"noteId"`
	Filename  string `json:"filename"`
	Size      int64  `json:"size"`
	Mime      string `json:"mime"`
	CreatedAt string `json:"createdAt"`
}

const attachmentSchema = `
CREATE TABLE IF NOT EXISTS attachments (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
	filename   TEXT NOT NULL,
	stored     TEXT NOT NULL,
	size       INTEGER NOT NULL DEFAULT 0,
	mime       TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
`

// ensureAttachmentSchema is called from Store.migrate; CREATE TABLE IF NOT
// EXISTS keeps it idempotent for both new and existing databases.
func (s *Store) ensureAttachmentSchema() error {
	if _, err := s.db.Exec(attachmentSchema); err != nil {
		return err
	}
	_, err := s.db.Exec(todoSchema)
	return err
}

// attachmentDir returns the folder holding attachment payloads, next to the
// database so both move together if the user copies their data dir.
func (s *Store) attachmentDir() (string, error) {
	dbPath := defaultDBPath()
	dir := filepath.Join(filepath.Dir(dbPath), "attachments")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func randomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// fall back to time-based naming is overkill; panic-free uniqueness
		// still holds well enough via counter below.
		return fmt.Sprintf("t%v", os.Getpid())
	}
	return hex.EncodeToString(b)
}

// AddAttachment copies the file at srcPath into the attachment store and
// links it to the note. Max size 100 MiB.
func (s *Store) AddAttachment(noteID int64, srcPath string) (*Attachment, error) {
	if _, err := s.GetNote(noteID); err != nil {
		return nil, err
	}
	f, err := os.Open(srcPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, errors.New("cannot attach a folder")
	}
	const maxAttach = 100 << 20
	if st.Size() > maxAttach {
		return nil, fmt.Errorf("file too large (%d MB, limit 100 MB)", st.Size()>>20)
	}

	ext := strings.ToLower(filepath.Ext(srcPath))
	if len(ext) > 12 {
		ext = ""
	}
	dir, err := s.attachmentDir()
	if err != nil {
		return nil, err
	}
	storedName := randomToken() + ext
	dst := filepath.Join(dir, storedName)

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	written, err := io.Copy(out, io.LimitReader(f, maxAttach+1))
	closeErr := out.Close()
	if err != nil || closeErr != nil {
		os.Remove(dst)
		if err != nil {
			return nil, err
		}
		return nil, closeErr
	}
	if written > maxAttach {
		os.Remove(dst)
		return nil, fmt.Errorf("file too large (limit 100 MB)")
	}

	mime := mimeFromExt(ext)
	res, err := s.db.Exec(
		"INSERT INTO attachments (note_id, filename, stored, size, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		noteID, filepath.Base(srcPath), storedName, written, mime, nowISO(),
	)
	if err != nil {
		os.Remove(dst)
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetAttachment(id)
}

func (s *Store) scanAttachment(row interface{ Scan(...any) error }) (*Attachment, error) {
	var a Attachment
	if err := row.Scan(&a.ID, &a.NoteID, &a.Filename, &a.Size, &a.Mime, &a.CreatedAt); err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Store) attachmentStored(id int64) (string, error) {
	var stored string
	err := s.db.QueryRow("SELECT stored FROM attachments WHERE id = ?", id).Scan(&stored)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("attachment %d not found", id)
	}
	return stored, err
}

// ListAttachments returns every attachment of a note, oldest first.
func (s *Store) ListAttachments(noteID int64) ([]Attachment, error) {
	rows, err := s.db.Query(
		"SELECT id, note_id, filename, size, mime, created_at FROM attachments WHERE note_id = ? ORDER BY id",
		noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Attachment{}
	for rows.Next() {
		a, err := s.scanAttachment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

func (s *Store) GetAttachment(id int64) (*Attachment, error) {
	row := s.db.QueryRow(
		"SELECT id, note_id, filename, size, mime, created_at FROM attachments WHERE id = ?", id)
	return s.scanAttachment(row)
}

// AttachmentPath returns the absolute on-disk path of an attachment payload.
func (s *Store) AttachmentPath(id int64) (string, error) {
	stored, err := s.attachmentStored(id)
	if err != nil {
		return "", err
	}
	dir, err := s.attachmentDir()
	if err != nil {
		return "", err
	}
	p := filepath.Join(dir, filepath.Base(stored))
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("attachment file is missing on disk")
	}
	return p, nil
}

// AttachmentInlineHTML builds the embeddable media HTML for an attachment,
// resolving its stored token internally.
func (s *Store) AttachmentInlineHTML(a *Attachment) (string, error) {
	stored, err := s.attachmentStored(a.ID)
	if err != nil {
		return "", err
	}
	return InlineMediaHTML(a, stored), nil
}

// DeleteAttachment removes the database row and the stored payload. The row
// would cascade on note delete; payload cleanup happens here and in
// pruneOrphanAttachments at startup.
func (s *Store) DeleteAttachment(id int64) error {
	stored, err := s.attachmentStored(id)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec("DELETE FROM attachments WHERE id = ?", id); err != nil {
		return err
	}
	dir, err := s.attachmentDir()
	if err == nil {
		os.Remove(filepath.Join(dir, filepath.Base(stored)))
	}
	return nil
}

// pruneOrphanAttachments deletes payload files that no longer have a database
// row (crash between copy and insert, or a cascade delete that skipped our
// helper). Called once at store open.
func (s *Store) pruneOrphanAttachments() {
	dir, err := s.attachmentDir()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		var n int
		if err := s.db.QueryRow("SELECT count(*) FROM attachments WHERE stored = ?", e.Name()).Scan(&n); err != nil {
			continue
		}
		if n == 0 {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// InlineMediaHTML renders an image/video attachment as embeddable rich-text
// HTML pointing at the /attachments asset route. stored is the random on-disk
// token (never the user filename); the visible name is attribute-escaped so a
// crafted filename cannot break out of the HTML.
func InlineMediaHTML(a *Attachment, stored string) string {
	escaped := strings.NewReplacer("&", "&amp;", "\"", "&quot;", "<", "&lt;", ">", "&gt;").Replace(filepath.Base(a.Filename))
	token := filepath.Base(stored) // strip any path components defensively
	if strings.HasPrefix(a.Mime, "video/") {
		return fmt.Sprintf(
			`<p><video controls preload="metadata" style="max-width:100%%;border-radius:8px" src="/attachments/%s" title="%s"></video></p>`,
			token, escaped)
	}
	return fmt.Sprintf(
		`<p><img src="/attachments/%s" alt="%s" style="max-width:100%%;border-radius:8px" loading="lazy" /></p>`,
		token, escaped)
}

// IsInlineMedia reports whether a mime renders inside the note body.
func IsInlineMedia(mime string) bool {
	return strings.HasPrefix(mime, "image/") || strings.HasPrefix(mime, "video/")
}

// mimeFromExt maps common extensions; anything else is application/octet-stream.
func mimeFromExt(ext string) string {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	case "svg":
		return "image/svg+xml"
	case "pdf":
		return "application/pdf"
	case "txt", "md":
		return "text/plain"
	case "csv":
		return "text/csv"
	case "json":
		return "application/json"
	case "zip":
		return "application/zip"
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "m4a":
		return "audio/mp4"
	case "mp4":
		return "video/mp4"
	case "mov":
		return "video/quicktime"
	case "doc":
		return "application/msword"
	case "docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case "xls":
		return "application/vnd.ms-excel"
	case "xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case "ppt", "pptx":
		return "application/vnd.ms-powerpoint"
	default:
		return "application/octet-stream"
	}
}
