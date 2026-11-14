package indexutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExtractSymbols(t *testing.T) {
	content := `import fs from 'fs';
import path from 'path';

export function foo() {}
async function bar() {}
export class Baz {}
export const qux = () => {};
const notFn = 42;
export const VAL = 1;
`
	syms := ExtractSymbols(content, "test.js")

	// Catatan: nama bisa muncul >1× (mis. `export const qux = () => {}` cocok
	// pola const_fn DAN export). Ini perilaku versi JS juga — jadi oracle-nya
	// cek keberadaan (kind, name), bukan map 1:1.
	type key struct{ kind, name string }
	got := map[key]bool{}
	for _, s := range syms {
		got[key{s.Kind, s.Name}] = true
	}
	want := []key{
		{"function", "foo"}, {"function", "bar"}, {"class", "Baz"},
		{"const_fn", "qux"}, {"export", "qux"}, {"export", "VAL"},
		{"import", "fs"}, {"import", "path"},
	}
	for _, k := range want {
		if !got[k] {
			t.Errorf("tidak ketemu: %s %s", k.kind, k.name)
		}
	}
	for _, s := range syms {
		if s.Name == "notFn" {
			t.Error("notFn tidak boleh terdeteksi sebagai simbol")
		}
	}
}

func TestLineNumbers(t *testing.T) {
	content := "line1\nline2\nfunction foo() {}\nline4\nclass Bar {}"
	syms := ExtractSymbols(content, "t.js")
	for _, s := range syms {
		if s.Name == "foo" && s.Line != 3 {
			t.Errorf("foo harus di baris 3, dapat %d", s.Line)
		}
		if s.Name == "Bar" && s.Line != 5 {
			t.Errorf("Bar harus di baris 5, dapat %d", s.Line)
		}
	}
}

func TestBuildIndex(t *testing.T) {
	dir := t.TempDir()
	f1 := filepath.Join(dir, "a.js")
	f2 := filepath.Join(dir, "b.js")
	os.WriteFile(f1, []byte("export function alpha() {}\n"), 0o644)
	os.WriteFile(f2, []byte("export class Beta {}\nexport const gamma = () => {}\n"), 0o644)

	r := BuildIndex([]string{f1, f2})
	if r.Files != 2 {
		t.Errorf("files: %d", r.Files)
	}
	// gamma ke-detect 2× (const_fn + export) — ini perilaku versi JS juga,
	// jadi oracle-nya memang 4 simbol (alpha, Beta, gamma×2).
	if len(r.Symbols) != 4 {
		t.Errorf("symbols: %d, mau 4", len(r.Symbols))
	}
	// totalLines = split('\n').length dijumlahkan (termasuk baris kosong akhir):
	// a.js = 2, b.js = 3 → 5. Sama dengan versi JS.
	if r.TotalLines != 5 {
		t.Errorf("totalLines: %d, mau 5", r.TotalLines)
	}
}

func TestBuildIndexMissingFile(t *testing.T) {
	r := BuildIndex([]string{"/tidak/ada/file.js"})
	if r.Files != 0 || len(r.Symbols) != 0 {
		t.Errorf("file hilang harus di-skip: %+v", r)
	}
}

func TestFindSymbol(t *testing.T) {
	syms := []Symbol{
		{Kind: "function", Name: "buildIndex"},
		{Kind: "function", Name: "findSymbol"},
		{Kind: "class", Name: "Indexer"},
	}
	if got := FindSymbol(syms, "index"); len(got) != 2 {
		t.Errorf("'index' harus 2 hasil: %+v", got)
	}
	if got := FindSymbol(syms, "INDEX"); len(got) != 2 {
		t.Error("harus case-insensitive")
	}
	if got := FindSymbol(syms, "zzz"); len(got) != 0 {
		t.Error("'zzz' harus kosong")
	}
}
