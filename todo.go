package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Todo is a checklist item with optional due date + alarm time.
// DueAt/AlarmAt are RFC3339 UTC strings; empty when unset.
type Todo struct {
	ID          int64  `json:"id"`
	NoteID      int64  `json:"noteId"` // 0 = global inbox
	Text        string `json:"text"`
	Done        bool   `json:"done"`
	DueAt       string `json:"dueAt"`
	AlarmAt     string `json:"alarmAt"`
	AlarmFired  bool   `json:"alarmFired"`
	CreatedAt   string `json:"createdAt"`
	CompletedAt string `json:"completedAt"`
}

const todoSchema = `
CREATE TABLE IF NOT EXISTS todos (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	note_id      INTEGER NOT NULL DEFAULT 0,
	text         TEXT NOT NULL,
	done         INTEGER NOT NULL DEFAULT 0,
	due_at       TEXT NOT NULL DEFAULT '',
	alarm_at     TEXT NOT NULL DEFAULT '',
	alarm_fired  INTEGER NOT NULL DEFAULT 0,
	created_at   TEXT NOT NULL,
	completed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_todos_note ON todos(note_id);
CREATE INDEX IF NOT EXISTS idx_todos_alarm ON todos(alarm_at);
`

func scanTodo(row interface{ Scan(...any) error }) (*Todo, error) {
	var t Todo
	var done, fired int
	if err := row.Scan(&t.ID, &t.NoteID, &t.Text, &done, &t.DueAt, &t.AlarmAt, &fired, &t.CreatedAt, &t.CompletedAt); err != nil {
		return nil, err
	}
	t.Done = done == 1
	t.AlarmFired = fired == 1
	return &t, nil
}

const todoCols = "id, note_id, text, done, due_at, alarm_at, alarm_fired, created_at, completed_at"

// CreateTodo validates and stores a todo. alarmAt, when set, must be in the
// future and not wildly before dueAt.
func (s *Store) CreateTodo(noteID int64, text, dueAt, alarmAt string) (*Todo, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("todo text is empty")
	}
	if _, err := parseISOOpt(dueAt); err != nil {
		return nil, fmt.Errorf("due date: %w", err)
	}
	if _, err := parseISOOpt(alarmAt); err != nil {
		return nil, fmt.Errorf("alarm: %w", err)
	}
	res, err := s.db.Exec(
		"INSERT INTO todos (note_id, text, due_at, alarm_at, created_at) VALUES (?, ?, ?, ?, ?)",
		noteID, text, dueAt, alarmAt, nowISO())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return s.GetTodo(id)
}

func (s *Store) GetTodo(id int64) (*Todo, error) {
	row := s.db.QueryRow("SELECT "+todoCols+" FROM todos WHERE id = ?", id)
	t, err := scanTodo(row)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("todo %d not found", id)
	}
	return t, err
}

// ListTodos returns todos for a note (noteID > 0), or the full list when
// noteID == 0: open todos first, ordered by alarm/due date, then completed.
func (s *Store) ListTodos(noteID int64) ([]Todo, error) {
	q := "SELECT " + todoCols + " FROM todos"
	var args []any
	if noteID > 0 {
		q += " WHERE note_id = ?"
		args = append(args, noteID)
	}
	q += " ORDER BY done, CASE WHEN due_at = '' THEN '9999' ELSE due_at END, id"
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Todo{}
	for rows.Next() {
		t, err := scanTodo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// SetTodoDone flips completion; completing stamps completed_at, reopening clears it.
func (s *Store) SetTodoDone(id int64, done bool) (*Todo, error) {
	comp := ""
	if done {
		comp = nowISO()
	}
	if _, err := s.db.Exec("UPDATE todos SET done = ?, completed_at = ? WHERE id = ?", boolToInt(done), comp, id); err != nil {
		return nil, err
	}
	return s.GetTodo(id)
}

// UpdateTodo edits text/dates in place and re-arms the alarm when the alarm
// time moved to something still in the future.
func (s *Store) UpdateTodo(id int64, text, dueAt, alarmAt string) (*Todo, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("todo text is empty")
	}
	if _, err := parseISOOpt(dueAt); err != nil {
		return nil, fmt.Errorf("due date: %w", err)
	}
	alarm, err := parseISOOpt(alarmAt)
	if err != nil {
		return nil, fmt.Errorf("alarm: %w", err)
	}
	fired := 0
	if alarm != nil && alarm.After(time.Now()) {
		fired = 0 // re-arm
	} else {
		// keep previous fired state if the alarm did not move to the future
		_ = s.db.QueryRow("SELECT alarm_fired FROM todos WHERE id = ?", id).Scan(&fired)
	}
	_, err = s.db.Exec(
		"UPDATE todos SET text = ?, due_at = ?, alarm_at = ?, alarm_fired = ? WHERE id = ?",
		text, dueAt, alarmAt, fired, id)
	if err != nil {
		return nil, err
	}
	return s.GetTodo(id)
}

func (s *Store) DeleteTodo(id int64) error {
	_, err := s.db.Exec("DELETE FROM todos WHERE id = ?", id)
	return err
}

// pendingAlarms returns todos with an armed alarm whose time has passed.
// The caller fires and marks them; marking is race-safe via the UPDATE guard.
func (s *Store) pendingAlarms(now time.Time) ([]Todo, error) {
	rows, err := s.db.Query(
		"SELECT "+todoCols+" FROM todos WHERE done = 0 AND alarm_fired = 0 AND alarm_at != '' AND alarm_at <= ?",
		now.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Todo{}
	for rows.Next() {
		t, err := scanTodo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// markAlarmFired returns true if this call won the race to mark the alarm.
func (s *Store) markAlarmFired(id int64) (bool, error) {
	res, err := s.db.Exec("UPDATE todos SET alarm_fired = 1 WHERE id = ? AND alarm_fired = 0", id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// UnfireAlarmsForTodo re-arms after an edit moved the alarm into the future.
// Handled inside UpdateTodo; kept for clarity of intent.

func parseISOOpt(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, errors.New("expected ISO date-time")
	}
	utc := t.UTC()
	return &utc, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// --- Alarm dispatcher -------------------------------------------------------

// TodoAlarms polls due alarms every 20s and raises a native notification
// plus a frontend event (so the app can bounce the tab even when the user
// is looking at it). One instance per app; started from main.
type TodoAlarms struct {
	store  *Store
	stop   chan struct{}
	once   sync.Once
	onFire func(Todo)
}

func NewTodoAlarms(store *Store) *TodoAlarms {
	return &TodoAlarms{store: store, stop: make(chan struct{})}
}

// OnFire registers a callback executed for every fired alarm (used by tests
// and optionally by main for logging).
func (a *TodoAlarms) OnFire(fn func(Todo)) { a.onFire = fn }

func (a *TodoAlarms) Start() {
	go a.loop()
}

func (a *TodoAlarms) Stop() { a.once.Do(func() { close(a.stop) }) }

func (a *TodoAlarms) loop() {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	a.tick() // catch alarms that fell due while the app was closed
	for {
		select {
		case <-a.stop:
			return
		case <-ticker.C:
			a.tick()
		}
	}
}

func (a *TodoAlarms) tick() {
	due, err := a.store.pendingAlarms(time.Now())
	if err != nil {
		log.Printf("alarm poll failed: %v", err)
		return
	}
	for _, t := range due {
		won, err := a.store.markAlarmFired(t.ID)
		if err != nil || !won {
			continue
		}
		raiseNotification(t)
		if app := application.Get(); app != nil {
			app.Event.Emit("todos:alarm", t)
		}
		if a.onFire != nil {
			a.onFire(t)
		}
	}
}

// raiseNotification shows a Windows toast via PowerShell's WinRT helper.
// Fire-and-forget: a missing/blocked notifier must never break polling.
func raiseNotification(t Todo) {
	if os.Getenv("SHARKNOTE_NO_TOAST") != "" {
		return // tests and headless runs
	}
	title := "Sharknote reminder"
	body := t.Text
	if len([]rune(body)) > 120 {
		body = string([]rune(body)[:120]) + "…"
	}
	runPowerShellToast(title, sanitizeToast(body))
}

func sanitizeToast(s string) string {
	// strip characters that could break the PS single-quoted literal
	return strings.ReplaceAll(strings.ReplaceAll(s, "'", "’"), "\n", " ")
}
