package main

import (
	"path/filepath"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestStoreCRUDAndLinks(t *testing.T) {
	s := testStore(t)

	alpha, err := s.CreateNote("Alpha", "See [[Beta]] and [[Gamma|the gamma note]].")
	if err != nil {
		t.Fatal(err)
	}
	beta, err := s.CreateNote("Beta", "Back to [[alpha]].")
	if err != nil {
		t.Fatal(err)
	}

	// Alpha resolves to Beta (and Gamma unresolved)
	out, err := s.GetOutgoingLinks(alpha.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 outgoing links, got %d", len(out))
	}
	if !out[0].Resolved || out[0].TargetID != beta.ID {
		t.Fatalf("first link should resolve to Beta: %+v", out[0])
	}
	if out[1].Resolved || out[1].TargetTitle != "Gamma" {
		t.Fatalf("second link should be unresolved Gamma: %+v", out[1])
	}

	// Beta links back to Alpha case-insensitively
	back, err := s.GetBacklinks(beta.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range back {
		if b.ID == alpha.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("Alpha should be a backlink of Beta: %+v", back)
	}

	// Graph has 2 nodes and 1 edge
	g, err := s.GetGraph()
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 2 || len(g.Edges) != 1 {
		t.Fatalf("want 2 nodes / 1 edge, got %d / %d", len(g.Nodes), len(g.Edges))
	}

	// Creating the Gamma note resolves the previously unresolved link
	gamma, err := s.CreateNote("Gamma", "hello")
	if err != nil {
		t.Fatal(err)
	}
	out, err = s.GetOutgoingLinks(alpha.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !out[1].Resolved || out[1].TargetID != gamma.ID {
		t.Fatalf("Gamma should now resolve: %+v", out[1])
	}

	// Search finds notes
	hits, err := s.SearchNotes("beta")
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 { // Alpha content + Beta title
		t.Fatalf("want 2 hits, got %d", len(hits))
	}
}

func TestSeed(t *testing.T) {
	s := testStore(t)
	if err := s.Seed(); err != nil {
		t.Fatal(err)
	}
	notes, err := s.ListNotes()
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) != 7 {
		t.Fatalf("want 7 seeded notes, got %d", len(notes))
	}
	// The tech-stack project note must not be part of the seed vault.
	for _, n := range notes {
		if n.Title == "Project: Sharknote app" {
			t.Fatal("seed vault must not contain the tech-stack project note")
		}
	}
	g, err := s.GetGraph()
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Edges) == 0 {
		t.Fatal("seeded vault should have links")
	}
}
