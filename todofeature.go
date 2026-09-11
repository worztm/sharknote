package main

import (
	"errors"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AttachmentService + TodoService: Wails-bound facades over the Store,
// mirroring the NoteService pattern. The native "attach file" dialog reuses
// the same picker as OpenFiles.

type AttachmentService struct{ store *Store }

func NewAttachmentService(store *Store) *AttachmentService {
	return &AttachmentService{store: store}
}

// List returns the attachments of a note.
func (a *AttachmentService) List(noteID int64) ([]Attachment, error) {
	return a.store.ListAttachments(noteID)
}

// AttachViaDialog opens the native file picker and copies the chosen file
// into the note's attachment store. Returns nil (no error) when cancelled.
func (a *AttachmentService) AttachViaDialog(noteID int64) (*Attachment, error) {
	paths, err := pickAttachmentPath()
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, nil // user cancelled
	}
	return a.store.AddAttachment(noteID, paths[0])
}

// AttachPath copies a known path (drag & drop from the OS gives real paths).
func (a *AttachmentService) AttachPath(noteID int64, path string) (*Attachment, error) {
	return a.store.AddAttachment(noteID, path)
}

// AttachMediaViaDialog opens the native picker limited to images/video and
// returns ready-to-insert inline HTML for the note body ("" when cancelled).
func (a *AttachmentService) AttachMediaViaDialog(noteID int64) (string, error) {
	paths, err := pickMediaPath()
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	att, err := a.store.AddAttachment(noteID, paths[0])
	if err != nil {
		return "", err
	}
	return a.store.AttachmentInlineHTML(att)
}

// AttachMediaPath stores a dropped image/video and returns its inline HTML.
// Non-media files return "" so the caller can fall back to the chip list.
func (a *AttachmentService) AttachMediaPath(noteID int64, path string) (string, error) {
	att, err := a.store.AddAttachment(noteID, path)
	if err != nil {
		return "", err
	}
	if !IsInlineMedia(att.Mime) {
		return "", nil // stored as a file chip, not inline
	}
	return a.store.AttachmentInlineHTML(att)
}

// Remove deletes an attachment row and its stored file.
func (a *AttachmentService) Remove(id int64) error {
	return a.store.DeleteAttachment(id)
}

// OpenWith launches the attachment in the OS default application.
func (a *AttachmentService) OpenWith(id int64) error {
	p, err := a.store.AttachmentPath(id)
	if err != nil {
		return err
	}
	return openPathWithDefaultApp(p)
}

// SaveCopyPath opens a native save dialog and copies the attachment out
// (returns the destination path). Empty string == cancelled.
func (a *AttachmentService) SaveCopyPath(id int64) (string, error) {
	a1, err := a.store.GetAttachment(id)
	if err != nil {
		return "", err
	}
	dst, err := saveAttachmentAs(a1.Filename)
	if err != nil {
		return "", err
	}
	if dst == "" {
		return "", nil
	}
	src, err := a.store.AttachmentPath(id)
	if err != nil {
		return "", err
	}
	if err := copyFile(src, dst); err != nil {
		return "", err
	}
	return dst, nil
}

type TodoService struct {
	store  *Store
	alarms *TodoAlarms
}

func NewTodoService(store *Store, alarms *TodoAlarms) *TodoService {
	return &TodoService{store: store, alarms: alarms}
}

func (t *TodoService) List(noteID int64) ([]Todo, error) { return t.store.ListTodos(noteID) }

func (t *TodoService) Create(noteID int64, text, dueAt, alarmAt string) (*Todo, error) {
	todo, err := t.store.CreateTodo(noteID, text, dueAt, alarmAt)
	if err == nil && t.alarms != nil {
		// nudge the poller so a near-term alarm is not delayed by up to 20s
		go t.alarms.tick()
	}
	return todo, err
}

func (t *TodoService) SetDone(id int64, done bool) (*Todo, error) {
	return t.store.SetTodoDone(id, done)
}

func (t *TodoService) Update(id int64, text, dueAt, alarmAt string) (*Todo, error) {
	todo, err := t.store.UpdateTodo(id, text, dueAt, alarmAt)
	if err == nil && t.alarms != nil {
		go t.alarms.tick()
	}
	return todo, err
}

func (t *TodoService) Delete(id int64) error { return t.store.DeleteTodo(id) }

// FireNow raises the alarm notification immediately (test/dev affordance and
// used by the UI's "snooze fired alarm" banner to re-notify).
func (t *TodoService) FireNow(id int64) error {
	todo, err := t.store.GetTodo(id)
	if err != nil {
		return err
	}
	raiseNotification(*todo)
	if app := application.Get(); app != nil {
		app.Event.Emit("todos:alarm", *todo)
	}
	return nil
}

var errNotImplemented = errors.New("not implemented on this platform")
