// Package fsutil — port dari src/utils/fs.js.
//
// Kontrak perilaku HARUS identik dengan versi JS: pesan placeholder, urutan
// pengecekan, dan bentuk hasil readFileRange. Test JS (tests/test-file-ops.mjs,
// test-bash-read.mjs, test-workspace-context.mjs) jadi oracle-nya.
package fsutil

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// BlockedNames — file yang tidak boleh diakses (kredensial).
var BlockedNames = map[string]bool{
	".env": true, ".env.local": true, ".env.production": true, ".env.development": true,
	"id_rsa": true, "id_ed25519": true, "id_ecdsa": true, "id_dsa": true,
	".ssh": true, ".gnupg": true, ".aws": true, ".npmrc": true, ".pypirc": true,
}

// BlockedSegments — segmen path yang diblokir.
var BlockedSegments = map[string]bool{".git": true}

// Workspace — root workspace yang jadi batas aman.
type Workspace struct {
	Root string
}

// NewWorkspace membuat workspace dari root (di-resolve absolut).
func NewWorkspace(root string) *Workspace {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	return &Workspace{Root: abs}
}

// Resolve mengubah target relatif jadi absolut terhadap root workspace.
func (w *Workspace) Resolve(target string) string {
	if target == "" {
		target = "."
	}
	if filepath.IsAbs(target) {
		return filepath.Clean(target)
	}
	return filepath.Join(w.Root, target)
}

// IsSafePath — cek apakah target aman diakses.
// Path harus resolve ke dalam root, tidak boleh symlink keluar, dan tidak
// mengandung segmen/file yang diblokir.
func (w *Workspace) IsSafePath(target string) bool {
	if target == "" {
		return false
	}
	resolved := w.Resolve(target)

	// Harus di dalam root.
	if resolved != w.Root && !strings.HasPrefix(resolved, w.Root+string(filepath.Separator)) {
		return false
	}

	// Cek segmen yang diblokir.
	rel := strings.TrimPrefix(resolved, w.Root)
	for _, seg := range strings.Split(rel, string(filepath.Separator)) {
		if seg == "" {
			continue
		}
		if BlockedNames[strings.ToLower(seg)] {
			return false
		}
		if BlockedSegments[seg] {
			return false
		}
	}

	// Cek symlink keluar (kalau file sudah ada).
	if real, err := filepath.EvalSymlinks(resolved); err == nil {
		if real != w.Root && !strings.HasPrefix(real, w.Root+string(filepath.Separator)) {
			return false
		}
	}
	// Kalau error (file belum ada) — izinkan, sama seperti versi JS.

	return true
}

// ReadFileSafe — baca file dengan aman, placeholder kalau tidak ada / dilarang.
func (w *Workspace) ReadFileSafe(target string) string {
	resolved := w.Resolve(target)
	if target == "" {
		return "(file tidak ditemukan)"
	}
	if _, err := os.Stat(resolved); err != nil {
		return "(file tidak ditemukan)"
	}
	if !w.IsSafePath(target) {
		return "(ACCESS DENIED: path diblokir karena keamanan)"
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return "(file tidak ditemukan)"
	}
	return string(data)
}

// RangeResult — hasil ReadFileRange.
type RangeResult struct {
	OK         bool   `json:"ok"`
	Content    string `json:"content"`
	TotalLines int    `json:"totalLines"`
	Start      int    `json:"start"`
	End        int    `json:"end"`
	Error      string `json:"error,omitempty"`
}

// ReadFileRange — baca file segian dengan nomor baris.
//
// Kenapa: ReadFileSafe mengembalikan seluruh isi, dan pemanggilnya memotong ke
// 2000 karakter. Buat file besar itu artinya agent cuma lihat awalannya — bug di
// baris 500 tidak akan pernah kelihatan. Ini memberi agent cara "geser jendela".
func (w *Workspace) ReadFileRange(target string, offset, limit int) RangeResult {
	off := offset
	if off < 1 {
		off = 1
	}
	// Catatan: JS pakai `Math.max(1, Math.min(Number(limit) || 400, 5000))`.
	// `Number(-10) || 400` = -10 (truthy), jadi limit negatif di-clamp ke 1 —
	// BUKAN ke 400. Hanya 0/NaN/undefined yang jatuh ke default 400.
	lim := limit
	if lim == 0 {
		lim = 400
	}
	if lim < 1 {
		lim = 1
	}
	if lim > 5000 {
		lim = 5000
	}

	if target == "" {
		return RangeResult{Content: "(file tidak ditemukan)", Error: "not_found"}
	}
	resolved := w.Resolve(target)
	info, err := os.Stat(resolved)
	if err != nil {
		return RangeResult{Content: "(file tidak ditemukan)", Error: "not_found"}
	}
	if !w.IsSafePath(target) {
		return RangeResult{Content: "(ACCESS DENIED: path diblokir karena keamanan)", Error: "blocked"}
	}
	if info.IsDir() {
		return RangeResult{Content: "(ini direktori, bukan file — pakai list_dir)", Error: "is_dir"}
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		return RangeResult{Content: fmt.Sprintf("(gagal baca: %s)", err.Error()), Error: "read_failed"}
	}

	all := strings.Split(string(data), "\n")
	totalLines := len(all)

	start := off
	if totalLines > 0 && start > totalLines {
		start = totalLines
	}
	if totalLines == 0 {
		start = 1
	}
	end := start + lim - 1
	if end > totalLines {
		end = totalLines
	}

	var slice []string
	if start-1 <= len(all) {
		slice = all[start-1 : end]
	}

	pad := len(fmt.Sprintf("%d", end))
	var b strings.Builder
	for i, line := range slice {
		b.WriteString(fmt.Sprintf("%*d|%s", pad, start+i, line))
		if i < len(slice)-1 {
			b.WriteString("\n")
		}
	}
	content := b.String()

	if end < totalLines {
		content += fmt.Sprintf("\n\n[...ADA %d BARIS LAGI. Lanjut: offset=%d limit=%d]", totalLines-end, end+1, lim)
	}

	return RangeResult{OK: true, Content: content, TotalLines: totalLines, Start: start, End: end}
}

// ListDirSafe — list isi direktori (menyembunyikan file sensitif).
func (w *Workspace) ListDirSafe(target string) string {
	dir := strings.TrimSpace(target)
	if dir == "" {
		dir = "."
	}
	resolved := w.Resolve(dir)
	if _, err := os.Stat(resolved); err != nil {
		return fmt.Sprintf("(direktori '%s' tidak ditemukan)", dir)
	}
	if !w.IsSafePath(dir) {
		return "(ACCESS DENIED: path diblokir karena keamanan)"
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		return fmt.Sprintf("(error baca direktori: %s)", err.Error())
	}
	if len(entries) == 0 {
		return "(kosong)"
	}

	var names []string
	for _, e := range entries {
		child := filepath.Join(dir, e.Name())
		if !w.IsSafePath(child) {
			continue
		}
		if e.IsDir() {
			names = append(names, e.Name()+"/")
		} else {
			names = append(names, e.Name())
		}
	}
	return strings.Join(names, "\n")
}

// LoadAgentMd — load AGENT.md dari root project.
func (w *Workspace) LoadAgentMd() (string, bool) {
	p := w.Resolve("AGENT.md")
	data, err := os.ReadFile(p)
	if err != nil {
		return "", false
	}
	return string(data), true
}
