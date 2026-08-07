package main

import (
	"os"
	"regexp"
	"strings"
)

// SaveNoteResult reports where a "Save as…" write landed. SavedPath is empty
// when the user cancelled the dialog.
type SaveNoteResult struct {
	SavedPath string `json:"savedPath"`
}

// sanitizeFileName turns a note title into something usable as a file name:
// Windows-invalid characters are replaced with spaces, and leading/trailing
// dots/spaces are trimmed. Empty results fall back to "Untitled".
func sanitizeFileName(title string) string {
	r := strings.NewReplacer(
		`\`, " ", "/", " ", ":", " ", "*", " ", "?", " ", `"`, " ", "<", " ", ">", " ", "|", " ",
	)
	name := r.Replace(title)
	name = strings.Trim(strings.TrimSpace(name), ". ")
	if name == "" {
		return "Untitled"
	}
	return name
}

// WriteNoteFile writes a note to the given path. The format follows the file
// extension: .md (markdown with frontmatter), .html (standalone page) or
// .txt (plain text); anything else is treated as markdown.
func WriteNoteFile(path string, note *Note) error {
	ext := strings.ToLower(path)
	switch {
	case strings.HasSuffix(ext, ".html") || strings.HasSuffix(ext, ".htm"):
		return os.WriteFile(path, []byte(exportHTML(note)), 0o644)
	case strings.HasSuffix(ext, ".txt"):
		return os.WriteFile(path, []byte(exportPlain(note)), 0o644)
	default:
		return os.WriteFile(path, []byte(exportMarkdown(note)), 0o644)
	}
}

// ---------- export format helpers -------------------------------------------

// frontmatterLine renders a single YAML value, quoting when needed so a title
// containing ':' doesn't break parsing.
func frontmatterLine(key, value string) string {
	v := strings.TrimSpace(value)
	if v == "" {
		return key + ": \"\""
	}
	if strings.ContainsAny(v, ":#\"'") {
		v = `"` + strings.ReplaceAll(v, `"`, `\"`) + `"`
	}
	return key + ": " + v
}

// ymd formats an ISO timestamp as the date part only (YYYY-MM-DD).
func ymd(iso string) string {
	if len(iso) >= 10 {
		return iso[:10]
	}
	return iso
}

func exportMarkdown(note *Note) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString(frontmatterLine("title", note.Title) + "\n")
	b.WriteString(frontmatterLine("created", ymd(note.CreatedAt)) + "\n")
	b.WriteString(frontmatterLine("updated", ymd(note.UpdatedAt)) + "\n")
	b.WriteString("---\n\n")
	b.WriteString("# " + note.Title + "\n\n")
	b.WriteString(htmlToMarkdown(note.Content))
	b.WriteString("\n")
	return b.String()
}

func exportHTML(note *Note) string {
	return "<!doctype html>\n" +
		"<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
		"<title>" + htmlEscape(note.Title) + "</title>\n" +
		"<style>body{max-width:42rem;margin:2rem auto;padding:0 1.5rem;" +
		"font:16px/1.7 system-ui,sans-serif}h1{margin-bottom:0.25rem}" +
		".meta{color:#777;font-size:0.85rem;margin-bottom:1.5rem;" +
		"padding-bottom:1rem;border-bottom:1px solid #ddd}</style>\n</head>\n<body>\n" +
		"<h1>" + htmlEscape(note.Title) + "</h1>\n" +
		"<div class=\"meta\">Created " + ymd(note.CreatedAt) + " · updated " + ymd(note.UpdatedAt) + "</div>\n" +
		"<div class=\"note\">\n" + note.Content + "\n</div>\n</body>\n</html>\n"
}

// exportPlain renders the note as readable plain text.
func exportPlain(note *Note) string {
	s := htmlToMarkdown(note.Content)
	for _, p := range []struct{ from, to string }{
		{"**", ""}, {"__", ""}, {"`", ""}, {"~~", ""},
	} {
		s = strings.ReplaceAll(s, p.from, p.to)
	}
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		t := strings.TrimSpace(ln)
		switch {
		case strings.HasPrefix(t, "# "):
			t = t[2:]
		case strings.HasPrefix(t, "- "):
			t = "• " + t[2:]
		case strings.HasPrefix(t, "_") && strings.HasSuffix(t, "_") && len(t) > 2:
			t = t[1 : len(t)-1]
		}
		lines[i] = t
	}
	s = strings.Join(lines, "\n")

	var b strings.Builder
	b.WriteString(note.Title + "\n")
	b.WriteString(strings.Repeat("=", len(note.Title)) + "\n\n")
	b.WriteString("Created: " + ymd(note.CreatedAt) + "\n")
	b.WriteString("Updated: " + ymd(note.UpdatedAt) + "\n\n")
	b.WriteString(strings.TrimSpace(s) + "\n")
	return b.String()
}

// htmlEscape escapes the few characters that matter inside an exported HTML
// <title>/heading — the body is already the app's stored rich text.
func htmlEscape(s string) string {
	return strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;",
	).Replace(s)
}

// ---------- HTML -> Markdown --------------------------------------------------

var (
	// htmlHeadings[i] matches the opening tag of an <h(i+1)> element.
	htmlHeadings = [6]*regexp.Regexp{
		regexp.MustCompile(`(?i)<h1[^>]*>`),
		regexp.MustCompile(`(?i)<h2[^>]*>`),
		regexp.MustCompile(`(?i)<h3[^>]*>`),
		regexp.MustCompile(`(?i)<h4[^>]*>`),
		regexp.MustCompile(`(?i)<h5[^>]*>`),
		regexp.MustCompile(`(?i)<h6[^>]*>`),
	}
	mdListStart = regexp.MustCompile(`(?i)<li[^>]*>\s*`)
	mdBlockGap  = regexp.MustCompile(`(?i)</(?:p|div|ul|ol|blockquote|table|pre|h[1-6]|li)>`)
	mdBlockEnd  = regexp.MustCompile(`(?i)<(?:p|div|ul|ol|blockquote|table|pre|h[1-6])[^>]*>`)
	mdBreak     = regexp.MustCompile(`(?i)<br\s*/?>`)
	mdBold      = regexp.MustCompile(`(?i)</?(?:strong|b)[^>]*>`)
	mdItalic    = regexp.MustCompile(`(?i)</?(?:em|i)[^>]*>`)
	mdCode      = regexp.MustCompile(`(?i)</?code[^>]*>`)
	mdStrike    = regexp.MustCompile(`(?i)</?(?:del|s)[^>]*>`)
	mdRule      = regexp.MustCompile(`(?i)<hr[^>]*>`)
	mdAnyTag    = regexp.MustCompile(`<[^>]*>`)
)

// htmlToMarkdown converts the stored rich text (HTML) into readable markdown:
// headings, lists, bold/italic/code/strike and [[wiki-links]] survive; tags
// without a markdown equivalent are dropped to their text. The result is a
// plain, human-readable document that imports back into Sharknote cleanly;
// it never round-trips byte-for-byte.
func htmlToMarkdown(s string) string {
	s = htmlEntityDecode(s)
	// Headings: <h3> → "### ".
	for i, mark := range [6]string{"# ", "## ", "### ", "#### ", "##### ", "###### "} {
		s = htmlHeadings[i].ReplaceAllString(s, mark)
	}
	// List items become "- " bullets (nested indentation is lost).
	s = mdListStart.ReplaceAllString(s, "\n- ")
	// Block endings and breaks turn into blank lines / line breaks.
	s = mdBlockGap.ReplaceAllString(s, "\n\n")
	s = mdBlockEnd.ReplaceAllString(s, "\n\n")
	s = mdBreak.ReplaceAllString(s, "\n")
	// Inline emphasis has a markdown spelling.
	s = mdBold.ReplaceAllString(s, "**")
	s = mdItalic.ReplaceAllString(s, "_")
	s = mdCode.ReplaceAllString(s, "`")
	s = mdStrike.ReplaceAllString(s, "~~")
	s = mdRule.ReplaceAllString(s, "\n\n---\n\n")
	// Anything left over is stripped, keeping its text.
	s = mdAnyTag.ReplaceAllString(s, "")
	return collapseBlankLines(strings.TrimSpace(s))
}

// htmlEntityDecode decodes the named/numeric entities the editor emits, so
// exported files read as plain characters.
func htmlEntityDecode(s string) string {
	repl := strings.NewReplacer(
		"&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`,
		"&#39;", "'", "&apos;", "'", "&#x27;", "'", "&#x2F;", "/",
		"&#34;", `"`, "&#38;", "&", "&#60;", "<", "&#62;", ">",
	)
	return repl.Replace(s)
}

// collapseBlankLines squeezes runs of blank lines (and leading newlines) down.
func collapseBlankLines(s string) string {
	for strings.Contains(s, "\n\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n\n", "\n\n")
	}
	return strings.Trim(s, "\n")
}