package main

import (
	"strings"
	"testing"
)

func TestRenameRewritesSelfLinks(t *testing.T) {
	s := testStore(t)

	note, err := s.CreateNote("Graph view", "Hi there, see [[Graph view]] for the map.")
	if err != nil {
		t.Fatal(err)
	}

	renamed, err := s.RenameNote(note.ID, "Graph")
	if err != nil {
		t.Fatal(err)
	}

	// The old self-link text inside the note itself must be rewritten too.
	if !strings.Contains(renamed.Content, "[[Graph]]") {
		t.Fatalf("self-link should be rewritten to [[Graph]], got %q", renamed.Content)
	}

	// And it must still resolve — to the renamed note itself.
	out, err := s.GetOutgoingLinks(renamed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || !out[0].Resolved || out[0].TargetID != renamed.ID {
		t.Fatalf("self-link should stay resolved to the renamed note, got %+v", out)
	}
}