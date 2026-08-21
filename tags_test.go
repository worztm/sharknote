package main

import "testing"

func TestToggleStar(t *testing.T) {
	s := testStore(t)
	n, err := s.CreateNote("starred note", "content")
	if err != nil {
		t.Fatal(err)
	}
	if n.Starred {
		t.Fatal("fresh note should not be starred")
	}
	on, err := s.ToggleStar(n.ID)
	if err != nil || !on {
		t.Fatalf("ToggleStar on: %v %v", on, err)
	}
	list, err := s.ListNotes()
	if err != nil {
		t.Fatal(err)
	}
	if list[0].ID != n.ID || !list[0].Starred {
		// starred notes sort first — it's currently the only note anyway
		t.Fatalf("list should carry starred flag: %+v", list[0])
	}
	off, err := s.ToggleStar(n.ID)
	if err != nil || off {
		t.Fatalf("ToggleStar off: %v %v", off, err)
	}
	got, err := s.GetNote(n.ID)
	if err != nil || got.Starred {
		t.Fatalf("starred did not persist: %+v %v", got, err)
	}
}

func TestMigrationAddsStarredColumn(t *testing.T) {
	s := testStore(t)
	// The migration must be idempotent — run it again on an up-to-date DB.
	s.migrate()
	s.migrate()
	if _, err := s.CreateNote("after migration", "ok"); err != nil {
		t.Fatalf("writes broken after double migration: %v", err)
	}
}
