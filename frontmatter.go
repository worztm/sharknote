package main

import (
	"regexp"
	"strings"
)

// Frontmatter holds the YAML metadata block found at the top of a markdown
// file, when one exists (--- delimited). Only the fields Sharknote uses are
// parsed; everything else is ignored but kept in the note content.
type Frontmatter struct {
	Title   string   // title: My Note
	Tags    []string // tags: [a, b] or tags:\n  - a\n  - b
	Aliases []string // aliases: [old name] (kept for future linking)
}

// frontmatterRE matches a leading YAML frontmatter block.
var frontmatterRE = regexp.MustCompile(`(?s)^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)`)

// keyRE matches a top-level "key: value" line inside the block.
var keyRE = regexp.MustCompile(`(?m)^([A-Za-z0-9_-]+):\s*(.*)$`)

// listItemRE matches "  - item" style list entries.
var listItemRE = regexp.MustCompile(`(?m)^\s*-\s+(.+?)\s*$`)

// unquote removes matching surrounding quotes from a YAML scalar.
func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// splitList parses an inline YAML list "[a, b, c]" or a plain comma list.
func splitList(s string) []string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = unquote(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// parseFrontmatter extracts the frontmatter block from a markdown document.
// It returns nil when the document has no frontmatter. The full source is
// always returned unchanged — frontmatter stays in the note so it round-trips
// and remains searchable through the FTS index.
func parseFrontmatter(source string) *Frontmatter {
	m := frontmatterRE.FindStringSubmatch(source)
	if m == nil {
		return nil
	}
	fm := &Frontmatter{}
	block := m[1]
	lines := strings.Split(block, "\n")

	// Tracks whether we are inside a list that belongs to the current key.
	var listKey string
	var list *[]string

	flush := func() {
		listKey = ""
		list = nil
	}

	for _, line := range lines {
		if lm := listItemRE.FindStringSubmatch(line); lm != nil && list != nil {
			*list = append(*list, unquote(lm[1]))
			continue
		}
		km := keyRE.FindStringSubmatch(line)
		if km == nil {
			flush()
			continue
		}
		key := strings.ToLower(km[1])
		val := strings.TrimSpace(km[2])
		flush()
		if key == "title" {
			fm.Title = unquote(val)
			continue
		}
		if key == "tags" || key == "aliases" {
			target := &fm.Tags
			if key == "aliases" {
				target = &fm.Aliases
			}
			if val == "" {
				// list form follows on indented lines
				listKey = key
				list = target
			} else {
				*target = splitList(val)
			}
		}
	}
	_ = listKey
	return fm
}
