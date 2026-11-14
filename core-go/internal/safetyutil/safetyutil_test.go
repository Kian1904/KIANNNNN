package safetyutil

import "testing"

func TestLevenshteinBasic(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"", "", 0},
		{"a", "", 1},
		{"", "a", 1},
		{"abc", "abc", 0},
		{"kitten", "sitting", 3},
		{"flaw", "lawn", 2},
		{"git", "gti", 2},
		{"nodejs", "node", 2},
		{"python", "pyton", 1},
		{"curl", "crul", 2},
	}
	for _, c := range cases {
		if got := LevenshteinDistance(c.a, c.b); got != c.want {
			t.Errorf("Levenshtein(%q,%q) = %d, mau %d", c.a, c.b, got, c.want)
		}
	}
}

func TestLevenshteinSymmetric(t *testing.T) {
	if LevenshteinDistance("abc", "xyz") != LevenshteinDistance("xyz", "abc") {
		t.Error("harus simetris")
	}
}

func TestLevenshteinUnicode(t *testing.T) {
	// rune-based, bukan byte-based
	if got := LevenshteinDistance("café", "cafe"); got != 1 {
		t.Errorf("unicode: %d, mau 1", got)
	}
}

func TestFindNearest(t *testing.T) {
	popular := []string{"git", "python", "nodejs", "curl", "wget", "vim"}

	r := FindNearest("gti", popular)
	if r.Closest != "git" || r.Distance != 2 {
		t.Errorf("gti: %+v", r)
	}

	r = FindNearest("node", popular)
	if r.Closest != "nodejs" || r.Distance != 2 {
		t.Errorf("node: %+v", r)
	}

	r = FindNearest("zzzzzzzz", popular)
	if r.Distance <= 3 {
		t.Errorf("zzzzzzzz harus jauh: %+v", r)
	}

	r = FindNearest("x", []string{})
	if r.Closest != "" || r.Distance != -1 {
		t.Errorf("kosong: %+v", r)
	}
}
