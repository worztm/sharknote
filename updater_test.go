package main

import "testing"

func TestIsNewerVersion(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"1.5.0", "1.4.0", true},
		{"1.10.0", "1.9.9", true},
		{"2.0.0", "1.99.99", true},
		{"1.4.1", "1.4.0", true},
		{"1.4.0", "1.4.0", false},
		{"1.3.9", "1.4.0", false},
		{"0.9", "1.0.0", false},
		// Unparsable manifests must never trigger an update.
		{"", "1.4.0", false},
		{"abc", "1.4.0", false},
		{"1.4.0-beta", "1.4.0", false},
	}
	for _, c := range cases {
		if got := isNewerVersion(c.latest, c.current); got != c.want {
			t.Errorf("isNewerVersion(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}

func TestParseVersion(t *testing.T) {
	if v, ok := parseVersion("V1.2.3"); !ok || v != [3]int{1, 2, 3} {
		t.Errorf("parseVersion with prefix/suffix: got %v ok=%v", v, ok)
	}
	if _, ok := parseVersion("1.4.0-beta"); ok {
		t.Error("prerelease strings should not parse")
	}
}
