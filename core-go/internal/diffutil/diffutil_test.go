package diffutil

import (
	"strings"
	"testing"
)

func TestNoDifference(t *testing.T) {
	if got := ShowDiff("a\nb\nc", "a\nb\nc"); got != "(tidak ada perbedaan)" {
		t.Errorf("identik: %q", got)
	}
	if got := ShowDiff("", ""); got != "(tidak ada perbedaan)" {
		t.Errorf("kosong: %q", got)
	}
}

func TestSimpleChange(t *testing.T) {
	got := ShowDiff("a\nb\nc", "a\nX\nc")
	if !strings.Contains(got, "@@ -1,3 +1,3 @@") {
		t.Errorf("header hunk salah: %q", got)
	}
	if !strings.Contains(got, "- b") {
		t.Errorf("baris hapus hilang: %q", got)
	}
	if !strings.Contains(got, "+ X") {
		t.Errorf("baris tambah hilang: %q", got)
	}
	if !strings.Contains(got, "  a") || !strings.Contains(got, "  c") {
		t.Errorf("context hilang: %q", got)
	}
}

func TestInsertMiddle(t *testing.T) {
	// Regresi asli: insert di tengah TIDAK boleh bikin semua baris ke-flag.
	old := "1\n2\n3\n4\n5"
	new := "1\n2\nBARU\n3\n4\n5"
	got := ShowDiff(old, new)
	if strings.Count(got, "\n- ") != 0 {
		t.Errorf("tidak boleh ada baris hapus: %q", got)
	}
	if !strings.Contains(got, "+ BARU") {
		t.Errorf("baris insert hilang: %q", got)
	}
}

func TestDeleteMiddle(t *testing.T) {
	got := ShowDiff("1\n2\n3\n4\n5", "1\n2\n4\n5")
	if !strings.Contains(got, "- 3") {
		t.Errorf("baris hapus hilang: %q", got)
	}
	if strings.Contains(got, "+ ") {
		t.Errorf("tidak boleh ada baris tambah: %q", got)
	}
}

func TestEmptyToContent(t *testing.T) {
	got := ShowDiff("", "a\nb")
	if !strings.Contains(got, "+ a") || !strings.Contains(got, "+ b") {
		t.Errorf("semua baris harus ditambah: %q", got)
	}
	// count=0 → start = baris sebelum (konvensi git)
	if !strings.Contains(got, "@@ -0,0 +1,2 @@") {
		t.Errorf("header konvensi git salah: %q", got)
	}
}

func TestContentToEmpty(t *testing.T) {
	got := ShowDiff("a\nb", "")
	if !strings.Contains(got, "- a") || !strings.Contains(got, "- b") {
		t.Errorf("semua baris harus dihapus: %q", got)
	}
	if !strings.Contains(got, "@@ -1,2 +0,0 @@") {
		t.Errorf("header konvensi git salah: %q", got)
	}
}

func TestHunkGrouping(t *testing.T) {
	// Dua perubahan berjauhan → dua hunk terpisah.
	var oldLines, newLines []string
	for i := 1; i <= 40; i++ {
		oldLines = append(oldLines, "baris-"+itoa(i))
		newLines = append(newLines, "baris-"+itoa(i))
	}
	newLines[2] = "UBAH-A"
	newLines[35] = "UBAH-B"
	got := ShowDiff(strings.Join(oldLines, "\n"), strings.Join(newLines, "\n"))
	if strings.Count(got, "@@") != 4 { // 2 hunk × 2 penanda @@
		t.Errorf("harus 2 hunk: %q", got)
	}
}

func TestLargeFallback(t *testing.T) {
	// > MAX_MYERS → block-replace, tetap akurat (semua beda setelah trim).
	var a, b []string
	for i := 0; i < 2000; i++ {
		a = append(a, "a-"+itoa(i))
		b = append(b, "b-"+itoa(i))
	}
	got := ShowDiff(strings.Join(a, "\n"), strings.Join(b, "\n"))
	if !strings.Contains(got, "- a-0") || !strings.Contains(got, "+ b-0") {
		t.Errorf("block-replace gagal: %q", got[:80])
	}
}

func TestPrefixSuffixTrim(t *testing.T) {
	// Prefix & suffix sama → hanya tengah yang jadi hunk.
	old := "same1\nsame2\nOLD\nsame3\nsame4"
	new := "same1\nsame2\nNEW\nsame3\nsame4"
	got := ShowDiff(old, new)
	if !strings.Contains(got, "- OLD") || !strings.Contains(got, "+ NEW") {
		t.Errorf("perubahan tengah hilang: %q", got)
	}
	if strings.Contains(got, "- same1") || strings.Contains(got, "+ same4") {
		t.Errorf("prefix/suffix tidak boleh jadi perubahan: %q", got)
	}
}
