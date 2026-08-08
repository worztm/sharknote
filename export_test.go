package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSanitizeFileName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Meeting notes", "Meeting notes"},
		{`C:\B/notes: "weird" *chars? ok|`, "C  B notes   weird   chars  ok"},
		{"Trailing dots...", "Trailing dots"},
		{"   ", "Untitled"},
		{"", "Untitled"},
		{".", "Untitled"},
	}
	for _, c := range cases {
		if got := sanitizeFileName(c.in); got != c.want {
			t.Errorf("sanitizeFileName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestHTMLToMarkdown(t *testing.T) {
	content := `<h1>Title</h1><p>Hello <strong>bold</strong> with <em>emphasis</em> and [[wiki link]].</p><ul><li>One</li><li>Two</li></ul><p>Code: <code>x := 1</code> struck <del>old</del>.</p>`
	got := htmlToMarkdown(content)
	for _, want := range []string{
		"# Title",
		"**bold**",
		"_emphasis_",
		"[[wiki link]]",
		"- One",
		"- Two",
		"`x := 1`",
		"~~old~~",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("htmlToMarkdown missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "<") {
		t.Errorf("htmlToMarkdown left HTML tags in output:\n%s", got)
	}
}

// A note whose body carries its own heading must not repeat the title in
// the exported page (the page heading already shows it).
func TestExportHTMLNotDuplicatingOwnHeading(t *testing.T) {
	n := &Note{
		Title:     "Idea vault",
		Content:   `<h1>Idea vault</h1><p>Body text.</p>`,
		CreatedAt: "2026-08-01T09:00:00Z",
		UpdatedAt: "2026-08-01T09:00:00Z",
	}
	s := exportHTML(n)
	if got := strings.Count(s, "<h1>Idea vault</h1>"); got != 1 {
		t.Fatalf("title heading appears %d times in the export, want 1:\n%s", got, s)
	}
	if !strings.Contains(s, "<p>Body text.</p>") {
		t.Fatalf("body text missing from export:\n%s", s)
	}
}

func TestWriteNoteFileFormats(t *testing.T) {
	dir := t.TempDir()
	note := &Note{
		ID: 1, Title: "Idea vault", Content: "<h1>Idea</h1><p>Hello <b>there</b>.</p>",
		CreatedAt: "2026-08-01T09:00:00Z", UpdatedAt: "2026-08-02T10:00:00Z",
	}

	md := filepath.Join(dir, "save.md")
	if err := WriteNoteFile(md, note); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(md)
	s := string(b)
	for _, want := range []string{"---", "title: Idea vault", "created: 2026-08-01", "updated: 2026-08-02", "# Idea vault", "**there**"} {
		if !strings.Contains(s, want) {
			t.Errorf("md export missing %q:\n%s", want, s)
		}
	}

	html := filepath.Join(dir, "save.html")
	if err := WriteNoteFile(html, note); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(html)
	s = string(b)
	if !strings.Contains(s, "<h1>Idea</h1>") || !strings.Contains(s, "<title>Idea vault</title>") {
		t.Errorf("html export wrong:\n%s", s)
	}

	txt := filepath.Join(dir, "save.txt")
	if err := WriteNoteFile(txt, note); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(txt)
	s = string(b)
	if !strings.Contains(s, "Idea vault") || strings.Contains(s, "<") {
		t.Errorf("txt export wrong:\n%s", s)
	}
}

func TestFrontmatterRoundTrip(t *testing.T) {
	n := &Note{
		Title: "Zettelkasten method", Content: "<p>Write <b>atomic</b> notes.</p>",
		CreatedAt: "2026-08-01T09:00:00Z", UpdatedAt: "2026-08-01T09:00:00Z",
	}
	f := parseFrontmatter(exportMarkdown(n))
	if f == nil || f.Title != "Zettelkasten method" {
		t.Errorf("frontmatter parse failed: %+v", f)
	}
}