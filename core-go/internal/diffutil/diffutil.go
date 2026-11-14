// Package diffutil — port dari src/diff.js.
//
// Line diff: prefix/suffix trim + Myers O(ND) + hunk context 3.
// Mengganti parallel line comparison lama: baris yang di-insert/delete di tengah
// kini TIDAK bikin seluruh file bergeser dan ke-flag semua.
//
// Kontrak perilaku HARUS identik dengan versi JS — tests/test-diff.mjs dan
// tests/test-go-diff.mjs jadi oracle-nya.
package diffutil

import "strings"

const (
	ctx      = 3    // baris context per hunk
	maxMyers = 3000 // batas baris sisa (pasca-trim) utk pakai Myers
	maxD     = 500  // batas edit distance — jaga memory O(D*(N+M)) di HP
)

// op — satu operasi diff relatif ke input.
type op struct {
	typ byte // '=', '-', '+'
	a   int  // index di old (valid utk '=' dan '-')
	b   int  // index di new (valid utk '=' dan '+')
}

// toLines — "" = 0 baris (konvensi git), selain itu split per baris.
func toLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

// myers — Myers greedy O(ND) ala Coglan: trace V per d, lalu backtrack.
// Return nil kalau melebihi maxD / gagal (pemanggil fallback block-replace).
func myers(a, b []string) []op {
	n, m := len(a), len(b)
	max := n + m
	offset := max
	v := make([]int32, 2*max+1)
	var trace [][]int32

	for d := 0; d <= max && d <= maxD; d++ {
		snapshot := make([]int32, len(v))
		copy(snapshot, v)
		trace = append(trace, snapshot)

		for k := -d; k <= d; k += 2 {
			var x int
			if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
				x = int(v[offset+k+1])
			} else {
				x = int(v[offset+k-1]) + 1
			}
			y := x - k
			for x < n && y < m && a[x] == b[y] {
				x++
				y++
			}
			v[offset+k] = int32(x)
			if x >= n && y >= m {
				return backtrack(trace, a, b, offset)
			}
		}
	}
	return nil
}

func backtrack(trace [][]int32, a, b []string, offset int) []op {
	x, y := len(a), len(b)
	var ops []op

	for d := len(trace) - 1; d >= 0; d-- {
		v := trace[d]
		k := x - y
		var prevK int
		if k == -d || (k != d && v[offset+k-1] < v[offset+k+1]) {
			prevK = k + 1
		} else {
			prevK = k - 1
		}
		prevX := int(v[offset+prevK])
		prevY := prevX - prevK
		for x > prevX && y > prevY {
			ops = append(ops, op{typ: '=', a: x - 1, b: y - 1})
			x--
			y--
		}
		if d > 0 {
			if x == prevX {
				ops = append(ops, op{typ: '+', b: prevY})
			} else {
				ops = append(ops, op{typ: '-', a: prevX})
			}
			x = prevX
			y = prevY
		}
	}

	// reverse
	for i, j := 0, len(ops)-1; i < j; i, j = i+1, j-1 {
		ops[i], ops[j] = ops[j], ops[i]
	}
	return ops
}

// ShowDiff — diff dua konten teks.
// Return unified diff dgn hunk '@@' (context 3), atau pesan tanpa perbedaan.
func ShowDiff(oldContent, newContent string) string {
	oldLines := toLines(oldContent)
	newLines := toLines(newContent)

	// Trim common prefix & suffix — potong sisanya jadi kecil utk kasus edit lokal.
	prefix := 0
	for prefix < len(oldLines) && prefix < len(newLines) && oldLines[prefix] == newLines[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(oldLines)-prefix && suffix < len(newLines)-prefix &&
		oldLines[len(oldLines)-1-suffix] == newLines[len(newLines)-1-suffix] {
		suffix++
	}

	aMid := oldLines[prefix : len(oldLines)-suffix]
	bMid := newLines[prefix : len(newLines)-suffix]

	if len(aMid) == 0 && len(bMid) == 0 {
		return "(tidak ada perbedaan)"
	}

	// Sisa terlalu besar utk Myers (memory) → block-replace.
	var midOps []op
	if len(aMid)+len(bMid) <= maxMyers {
		midOps = myers(aMid, bMid)
	}
	if midOps == nil {
		midOps = make([]op, 0, len(aMid)+len(bMid))
		for i := range aMid {
			midOps = append(midOps, op{typ: '-', a: i})
		}
		for i := range bMid {
			midOps = append(midOps, op{typ: '+', b: i})
		}
	}

	// Gabung full ops: prefix yang sama + tengah (di-shift) + suffix yang sama.
	full := make([]op, 0, prefix+len(midOps)+suffix)
	for i := 0; i < prefix; i++ {
		full = append(full, op{typ: '=', a: i, b: i})
	}
	for _, o := range midOps {
		switch o.typ {
		case '=':
			full = append(full, op{typ: '=', a: prefix + o.a, b: prefix + o.b})
		case '-':
			full = append(full, op{typ: '-', a: prefix + o.a})
		case '+':
			full = append(full, op{typ: '+', b: prefix + o.b})
		}
	}
	for i := 0; i < suffix; i++ {
		full = append(full, op{typ: '=', a: len(oldLines) - suffix + i, b: len(newLines) - suffix + i})
	}

	// Kelompokkan jadi hunk: gabung gap perubahan <= 2*CTX.
	var changeIdx []int
	for i, o := range full {
		if o.typ != '=' {
			changeIdx = append(changeIdx, i)
		}
	}

	type group struct{ start, end int }
	var groups []group
	for _, i := range changeIdx {
		if len(groups) > 0 {
			last := &groups[len(groups)-1]
			if i-last.end <= ctx*2 {
				last.end = i
				continue
			}
		}
		groups = append(groups, group{start: i, end: i})
	}

	var out []string
	for _, g := range groups {
		from := g.start - ctx
		if from < 0 {
			from = 0
		}
		to := g.end + ctx
		if to > len(full)-1 {
			to = len(full) - 1
		}

		// Hitung nomor baris awal hunk (1-based).
		aNum, bNum := 0, 0
		for i := 0; i < from; i++ {
			if full[i].typ != '+' {
				aNum++
			}
			if full[i].typ != '-' {
				bNum++
			}
		}
		aCount, bCount := 0, 0
		var body []string
		for i := from; i <= to; i++ {
			o := full[i]
			switch o.typ {
			case '=':
				body = append(body, "  "+oldLines[o.a])
				aCount++
				bCount++
			case '-':
				body = append(body, "- "+oldLines[o.a])
				aCount++
			case '+':
				body = append(body, "+ "+newLines[o.b])
				bCount++
			}
		}
		aStart := aNum + 1
		if aCount == 0 {
			aStart = aNum // git convention: count=0 -> start = baris sebelum
		}
		bStart := bNum + 1
		if bCount == 0 {
			bStart = bNum
		}
		out = append(out, "@@ -"+itoa(aStart)+","+itoa(aCount)+" +"+itoa(bStart)+","+itoa(bCount)+" @@")
		out = append(out, body...)
	}

	return strings.Join(out, "\n")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}
