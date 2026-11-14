// Package indexutil — port dari src/indexer.js.
//
// Index simbol codebase (fungsi, class, export, import). Operasi CPU-bound
// berat: regex + loop di ribuan baris. Ini kandidat yang BENERAN cocok buat Go
// (beda dari regex/Levenshtein yang selesai <1ms di JS).
//
// Catatan: Go baca file sendiri (payload ke bridge cuma daftar path, bukan isi
// file) — ini menghindari biaya JSON serialisasi konten besar.
package indexutil

import (
	"os"
	"regexp"
	"strings"
)

// SymbolPattern — satu pola ekstraksi simbol.
type SymbolPattern struct {
	Kind string
	Re   *regexp.Regexp
}

// SymbolPatterns — urutan HARUS sama dengan versi JS.
var SymbolPatterns = []SymbolPattern{
	{"function", regexp.MustCompile(`(?m)^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)`)},
	{"class", regexp.MustCompile(`(?m)^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)`)},
	{"const_fn", regexp.MustCompile(`(?m)^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(`)},
	{"export", regexp.MustCompile(`(?m)^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)`)},
	{"import", regexp.MustCompile(`(?m)^\s*import\s+.*?from\s+['"]([^'"]+)['"]`)},
}

// Symbol — satu simbol yang ketemu.
type Symbol struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	File string `json:"file"`
	Line int    `json:"line"`
}

// IndexResult — hasil build index.
type IndexResult struct {
	Symbols    []Symbol `json:"symbols"`
	Files      int      `json:"files"`
	TotalLines int      `json:"totalLines"`
}

// ExtractSymbols — ekstrak simbol dari satu konten file.
func ExtractSymbols(content, file string) []Symbol {
	symbols := []Symbol{}
	for _, p := range SymbolPatterns {
		// FindAllStringSubmatchIndex memberi posisi byte — dipakai buat hitung baris.
		matches := p.Re.FindAllStringSubmatchIndex(content, -1)
		for _, m := range matches {
			if len(m) < 4 {
				continue
			}
			name := content[m[2]:m[3]]
			line := 1 + strings.Count(content[:m[0]], "\n")
			symbols = append(symbols, Symbol{Kind: p.Kind, Name: name, File: file, Line: line})
		}
	}
	return symbols
}

// BuildIndex — bangun index dari daftar file.
// Go baca file sendiri (payload bridge cuma daftar path).
func BuildIndex(files []string) IndexResult {
	symbols := []Symbol{}
	totalLines := 0
	read := 0
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		content := string(data)
		read++
		totalLines += strings.Count(content, "\n") + 1
		symbols = append(symbols, ExtractSymbols(content, f)...)
	}
	return IndexResult{Symbols: symbols, Files: read, TotalLines: totalLines}
}

// FindSymbol — cari simbol berdasarkan nama (substring, case-insensitive).
func FindSymbol(symbols []Symbol, query string) []Symbol {
	q := strings.ToLower(query)
	out := []Symbol{}
	for _, s := range symbols {
		if strings.Contains(strings.ToLower(s.Name), q) {
			out = append(out, s)
		}
	}
	return out
}
