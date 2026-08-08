package main

import (
	"strings"
	"testing"
)

func TestBacklinkExcerptShowsTheRightLinkContext(t *testing.T) {
	s := testStore(t)

	a, err := s.CreateNote("Alpha", "unused")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateNote("Zebra", "unused"); err != nil {
		t.Fatal(err)
	}
	bravo, err := s.CreateNote("Bravo",
		"Some [[Zebra]] mention at the top of the note.\n\n"+
			"The real deal: [[Alpha]] lives right here.")
	if err != nil {
		t.Fatal(err)
	}

	// The backlink for Alpha must show the context around [[Alpha]],
	// not the first wiki-link in the note (which points at Zebra).
	back, err := s.GetBacklinks(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(back) != 1 || back[0].ID != bravo.ID {
		t.Fatalf("want Bravo as Alpha's only backlink, got %+v", back)
	}
	if !strings.Contains(back[0].Excerpt, "real deal") {
		t.Fatalf("excerpt should surround the [[Alpha]] link, got %q", back[0].Excerpt)
	}
}