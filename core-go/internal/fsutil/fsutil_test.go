package fsutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setup(t *testing.T) (*Workspace, string) {
	t.Helper()
	root := t.TempDir()
	ws := NewWorkspace(root)
	return ws, root
}

func write(t *testing.T, root, name, content string) string {
	t.Helper()
	p := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestIsSafePath(t *testing.T) {
	ws, root := setup(t)
	write(t, root, "ada.txt", "ok")

	if !ws.IsSafePath("ada.txt") {
		t.Error("file kerja harus aman")
	}
	if ws.IsSafePath("/etc/hosts") {
		t.Error("/etc/hosts harus tidak aman")
	}
	if ws.IsSafePath(filepath.Join(root, ".env")) {
		t.Error(".env harus tidak aman")
	}
	if ws.IsSafePath("../outside.txt") {
		t.Error("path di luar root harus tidak aman")
	}
	if ws.IsSafePath("") {
		t.Error("target kosong harus tidak aman")
	}
	if ws.IsSafePath(filepath.Join(root, ".git", "config")) {
		t.Error(".git harus tidak aman")
	}
}

func TestReadFileSafe(t *testing.T) {
	ws, root := setup(t)
	write(t, root, "ada.txt", "isi file")
	write(t, root, ".env", "SECRET=1")

	if got := ws.ReadFileSafe("ada.txt"); got != "isi file" {
		t.Errorf("baca file: dapat %q", got)
	}
	if got := ws.ReadFileSafe("hilang.txt"); got != "(file tidak ditemukan)" {
		t.Errorf("file hilang: dapat %q", got)
	}
	// .env ADA tapi diblokir → ACCESS DENIED (bukan "tidak ditemukan").
	if got := ws.ReadFileSafe(".env"); got != "(ACCESS DENIED: path diblokir karena keamanan)" {
		t.Errorf(".env: dapat %q", got)
	}
	// .env yang TIDAK ada → "tidak ditemukan" (cek exists dulu, sama seperti JS).
	if got := ws.ReadFileSafe(".env.local"); got != "(file tidak ditemukan)" {
		t.Errorf(".env.local (tidak ada): dapat %q", got)
	}
}

func TestReadFileRange(t *testing.T) {
	ws, root := setup(t)
	var lines []string
	for i := 1; i <= 1000; i++ {
		lines = append(lines, "baris-"+itoa(i))
	}
	write(t, root, "big.txt", strings.Join(lines, "\n"))

	r1 := ws.ReadFileRange("big.txt", 1, 10)
	if !r1.OK || r1.Start != 1 || r1.End != 10 || r1.TotalLines != 1000 {
		t.Errorf("range 1-10: %+v", r1)
	}
	if !strings.Contains(r1.Content, "1|baris-1") {
		t.Errorf("nomor baris hilang: %q", r1.Content[:40])
	}
	if !strings.Contains(r1.Content, "ADA 990 BARIS LAGI") {
		t.Error("hint baris lanjutan hilang")
	}

	r2 := ws.ReadFileRange("big.txt", 500, 10)
	if r2.Start != 500 || r2.End != 509 {
		t.Errorf("range 500-509: %+v", r2)
	}

	// offset/limit negatif → offset clamp ke 1, limit clamp ke 1 (bukan 400).
	// Ini match JS: `Math.max(1, Math.min(Number(-10) || 400, 5000))` = 1.
	rNeg := ws.ReadFileRange("big.txt", -5, -10)
	if rNeg.Start != 1 || rNeg.End != 1 {
		t.Errorf("clamp negatif: start=%d end=%d (harus 1,1)", rNeg.Start, rNeg.End)
	}

	// limit 0 → default 400 (0 falsy di JS).
	rZero := ws.ReadFileRange("big.txt", 1, 0)
	if rZero.End != 400 {
		t.Errorf("limit 0 → default 400: end=%d", rZero.End)
	}

	// limit besar → di-clamp ke 5000
	rHuge := ws.ReadFileRange("big.txt", 1, 999999)
	if rHuge.End != 1000 {
		t.Errorf("clamp limit: end=%d", rHuge.End)
	}

	// file hilang
	rMissing := ws.ReadFileRange("gak-ada.txt", 1, 10)
	if rMissing.OK || rMissing.Error != "not_found" {
		t.Errorf("file hilang: %+v", rMissing)
	}

	// direktori
	if err := os.MkdirAll(filepath.Join(root, "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	rDir := ws.ReadFileRange("dir", 1, 10)
	if rDir.Error != "is_dir" {
		t.Errorf("direktori: %+v", rDir)
	}
}

func TestListDirSafe(t *testing.T) {
	ws, root := setup(t)
	write(t, root, "x.txt", "ok")
	write(t, root, ".env", "secret")
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}

	got := ws.ListDirSafe(".")
	if !strings.Contains(got, "x.txt") {
		t.Error("x.txt harus muncul")
	}
	if !strings.Contains(got, "sub/") {
		t.Error("sub/ harus muncul dengan slash")
	}
	if strings.Contains(got, ".env") {
		t.Error(".env harus disembunyikan")
	}
	if got := ws.ListDirSafe("gak-ada"); !strings.Contains(got, "tidak ditemukan") {
		t.Errorf("dir hilang: %q", got)
	}
}

func TestLoadAgentMd(t *testing.T) {
	ws, root := setup(t)
	if _, found := ws.LoadAgentMd(); found {
		t.Error("AGENT.md belum ada, harus found=false")
	}
	write(t, root, "AGENT.md", "# Aturan")
	content, found := ws.LoadAgentMd()
	if !found || content != "# Aturan" {
		t.Errorf("load AGENT.md: found=%v content=%q", found, content)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
