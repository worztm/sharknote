package main

import (
	"os"
	"strings"
	"path/filepath"
	"testing"
	"time"
)

func TestInlineMediaHTML(t *testing.T) {
	a := &Attachment{ID: 1, Filename: `evil"><script>alert(1)</script>.png`, Mime: "image/png"}
	html := InlineMediaHTML(a, "..\\..\\stuff\\abcdef.png")
	if strings.Contains(html, "<script>") {
		t.Fatalf("filename not escaped: %s", html)
	}
	if !strings.Contains(html, `src="/attachments/abcdef.png"`) {
		t.Fatalf("stored token not reduced to base name: %s", html)
	}
	if strings.Contains(html, "..") {
		t.Fatalf("path traversal leaked into url: %s", html)
	}
	v := &Attachment{ID: 2, Filename: "clip.mp4", Mime: "video/mp4"}
	hv := InlineMediaHTML(v, "deadbeef.mp4")
	if !strings.Contains(hv, "<video controls") || !strings.Contains(hv, "deadbeef.mp4") {
		t.Fatalf("video html wrong: %s", hv)
	}
}

func TestAttachmentLifecycle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sn.db")
	t.Setenv("SHARKNOTE_DB", dbPath)
	st, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	note, err := st.CreateNote("Attach target", "hello")
	if err != nil {
		t.Fatal(err)
	}

	src := filepath.Join(t.TempDir(), "photo.png")
	payload := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 'x', 'y'}
	if err := os.WriteFile(src, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	a, err := st.AddAttachment(note.ID, src)
	if err != nil {
		t.Fatal(err)
	}
	if a.Filename != "photo.png" || a.Size != int64(len(payload)) || a.Mime != "image/png" {
		t.Fatalf("bad attachment row: %+v", a)
	}

	list, err := st.ListAttachments(note.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %d %v", len(list), err)
	}

	p, err := st.AttachmentPath(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(p)
	if err != nil || string(got) != string(payload) {
		t.Fatalf("payload mismatch: %q %v", got, err)
	}

	if err := st.DeleteAttachment(a.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := st.ListAttachments(note.ID); len(list) != 0 {
		t.Fatalf("attachment survived delete")
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("payload file survived delete")
	}
}

func TestAttachmentCascadeAndPrune(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sn.db")
	t.Setenv("SHARKNOTE_DB", dbPath)
	st, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	note, _ := st.CreateNote("Cascade", "x")
	src := filepath.Join(t.TempDir(), "a.txt")
	os.WriteFile(src, []byte("data"), 0o600)
	a, err := st.AddAttachment(note.ID, src)
	if err != nil {
		t.Fatal(err)
	}
	// orphan payload: file exists, no row
	dir, _ := st.attachmentDir()
	orphan := filepath.Join(dir, "deadbeef.txt")
	os.WriteFile(orphan, []byte("junk"), 0o600)

	// note delete cascades the row (payload cleanup is the helper's job)
	if err := st.DeleteNote(note.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := st.ListAttachments(note.ID); len(list) != 0 {
		t.Fatalf("cascade failed")
	}
	_ = st.DeleteAttachment(a.ID) // row already gone -> error expected, must not panic

	st.Close()

	// reopening prunes orphan payloads
	st2, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatalf("prune did not remove orphan payload")
	}
}

func TestAttachmentSizeLimitAndFolder(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "sn.db")
	t.Setenv("SHARKNOTE_DB", dbPath)
	st, _ := NewStore(dbPath)
	defer st.Close()
	note, _ := st.CreateNote("Limits", "x")

	d := t.TempDir()
	if _, err := st.AddAttachment(note.ID, d); err == nil {
		t.Fatal("folder attach should fail")
	}
}

func TestTodoLifecycleAndAlarm(t *testing.T) {
	t.Setenv("SHARKNOTE_NO_TOAST", "1")
	dbPath := filepath.Join(t.TempDir(), "sn.db")
	t.Setenv("SHARKNOTE_DB", dbPath)
	st, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	note, _ := st.CreateNote("Todo host", "x")

	alarm := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339) // already due
	due := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	td, err := st.CreateTodo(note.ID, "ship v2", due, alarm)
	if err != nil {
		t.Fatal(err)
	}
	if td.Done || td.AlarmFired {
		t.Fatalf("fresh todo wrong state: %+v", td)
	}

	// dispatcher tick must find and fire it exactly once
	fired := 0
	al := NewTodoAlarms(st)
	al.OnFire(func(Todo) { fired++ })
	al.tick()
	al.tick() // second tick must not double-fire
	if fired != 1 {
		t.Fatalf("alarm fired %d times, want 1", fired)
	}

	// completing stops future firing
	td2, _ := st.CreateTodo(0, "later", "", time.Now().UTC().Add(time.Hour).Format(time.RFC3339))
	if _, err := st.SetTodoDone(td2.ID, true); err != nil {
		t.Fatal(err)
	}
	got, _ := st.GetTodo(td2.ID)
	if !got.Done || got.CompletedAt == "" {
		t.Fatalf("done state wrong: %+v", got)
	}

	// update with a future alarm re-arms
	_, err = st.UpdateTodo(td.ID, "ship v2 (edited)", due, time.Now().UTC().Add(2*time.Hour).Format(time.RFC3339))
	if err != nil {
		t.Fatal(err)
	}
	again, _ := st.GetTodo(td.ID)
	if again.AlarmFired {
		t.Fatalf("moving alarm to the future must re-arm")
	}

	// validation
	if _, err := st.CreateTodo(0, "  ", "", ""); err == nil {
		t.Fatal("empty text should fail")
	}
	if _, err := st.CreateTodo(0, "x", "not-a-date", ""); err == nil {
		t.Fatal("bad due date should fail")
	}

	if err := st.DeleteTodo(td.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetTodo(td.ID); err == nil {
		t.Fatal("deleted todo still readable")
	}
}
