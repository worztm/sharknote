package main

import (
	"strings"
	"testing"
)

func TestRewriteWikiTitle(t *testing.T) {
	cases := []struct {
		name, content, oldTitle, newTitle, want string
	}{
		{
			name: "plain link",
			content: `Read [[Graph view]] for more.`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `Read [[Graph]] for more.`,
		},
		{
			name: "aliased link keeps alias",
			content: `See [[Graph view|the map]] now.`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `See [[Graph|the map]] now.`,
		},
		{
			name: "section anchor keeps section",
			content: `Jump to [[Graph view#Layers]].`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `Jump to [[Graph#Layers]].`,
		},
		{
			name: "case insensitive",
			content: `see [[graph VIEW]] today`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `see [[Graph]] today`,
		},
		{
			name: "no partial matches",
			content: `[[Graph viewport]] and [[Graph view extra]]`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `[[Graph viewport]] and [[Graph view extra]]`,
		},
		{
			name: "multiple links all rewritten",
			content: `[[Graph view]] then [[Graph view|again]] then [[Graph view#S]]`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `[[Graph]] then [[Graph|again]] then [[Graph#S]]`,
		},
		{
			name: "unrelated links untouched",
			content: `[[Welcome]] keeps [[Zettelkasten method]].`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `[[Welcome]] keeps [[Zettelkasten method]].`,
		},
		{
			name: "embedded in HTML",
			content: `<p>Try <b>[[Graph view]]</b> now.</p>`,
			oldTitle: "Graph view", newTitle: "Graph",
			want: `<p>Try <b>[[Graph]]</b> now.</p>`,
		},
	}
	for _, c := range cases {
		got := rewriteWikiTitle(c.content, c.oldTitle, c.newTitle)
		if got != c.want {
			t.Errorf("%s\n got %q\nwant %q", c.name, got, c.want)
		}
	}
}

func TestStoreRenameNoteRewritesLinks(t *testing.T) {
	s := testStore(t)

	// Two notes that link (one alias, one plain) to the note being renamed,
	// plus a pending link that only becomes valid after the rename.
	if _, err := s.CreateNote("Alpha", "Read [[Old Name]] now."); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateNote("Beta", "See [[old name|the piece]] later."); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateNote("Future", "One day: [[Old Name#Ideas]]"); err != nil {
		t.Fatal(err)
	}
	target, err := s.CreateNote("Old Name", "The subject.")
	if err != nil {
		t.Fatal(err)
	}

	renamed, err := s.RenameNote(target.ID, "Fresh Name")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Title != "Fresh Name" {
		t.Fatalf("title = %q, want Fresh Name", renamed.Title)
	}

	// The literal [[links]] in the other notes were rewritten.
	alpha, err := s.GetNote(1)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(alpha.Content, "[[Fresh Name]]") || strings.Contains(alpha.Content, "Old Name") {
		t.Errorf("Alpha content not rewritten: %q", alpha.Content)
	}
	beta, err := s.GetNote(2)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(beta.Content, "[[Fresh Name|the piece]]") {
		t.Errorf("Beta alias link not rewritten: %q", beta.Content)
	}
	future, err := s.GetNote(3)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(future.Content, "[[Fresh Name#Ideas]]") {
		t.Errorf("Future section link not rewritten: %q", future.Content)
	}

	// Backlinks now point at the renamed note and the graph edge exists.
	back, err := s.GetBacklinks(renamed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(back) != 3 {
		t.Errorf("backlinks = %d, want 3 (alpha, beta, future): %+v", len(back), back)
	}
	g, err := s.GetGraph()
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Edges) < 3 {
		t.Errorf("graph edges = %d, want >= 3", len(g.Edges))
	}
}

func TestRenameNoteEmptyAndIdentical(t *testing.T) {
	s := testStore(t)
	n, err := s.CreateNote("Keep", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RenameNote(n.ID, "   "); err == nil {
		t.Fatal("want error for empty title")
	}
	again, err := s.RenameNote(n.ID, "Keep")
	if err != nil {
		t.Fatal(err)
	}
	if again.Title != "Keep" || again.Content != "" {
		t.Fatalf("identical rename changed the note: %+v", again)
	}
}