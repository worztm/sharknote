package main

import (
	"net/http"
	"path/filepath"
	"strings"
)

// attachmentFileServer serves stored attachment payloads at /attachments/<stored>
// so the webview can render images and play video inline in notes. Every request
// must match a database row by stored token, which keeps the URL from reaching
// any path outside the attachments directory.
func attachmentFileServer(store *Store, next http.Handler) http.Handler {
	dir, err := store.attachmentDir()
	if err != nil {
		// Data dir not creatable; attachment serving stays off, app still runs.
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/attachments/") {
			next.ServeHTTP(w, r)
			return
		}
		name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/attachments/"))
		var noteID int64
		if err := store.db.QueryRow("SELECT note_id FROM attachments WHERE stored = ?", name).Scan(&noteID); err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=3600")
		http.ServeFile(w, r, filepath.Join(dir, name))
	})
}
