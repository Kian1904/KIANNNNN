// Package safetyutil — port dari bagian CPU-bound src/package-safety.js.
//
// Yang di-port HANYA algoritma murni (Levenshtein + pencarian tetangga terdekat).
// Network I/O (fetch registry, apt-cache) TETAP di JS — JS unggul di async I/O.
//
// Kenapa Levenshtein cocok di Go: O(n×m) murni, CPU-bound, payload kecil
// (nama package). Ini kebalikan dari regex (yang V8 sudah sangat cepat).
package safetyutil

// LevenshteinDistance — jarak edit antara dua string.
// Port 1:1 dari versi JS (matriks penuh, bukan optimasi 2-baris) supaya
// perilakunya identik.
func LevenshteinDistance(a, b string) int {
	ar := []rune(a)
	br := []rune(b)
	la, lb := len(ar), len(br)

	// matrix[i][j] — i untuk b, j untuk a (mengikuti versi JS)
	matrix := make([][]int, lb+1)
	for i := range matrix {
		matrix[i] = make([]int, la+1)
	}
	for i := 0; i <= lb; i++ {
		matrix[i][0] = i
	}
	for j := 0; j <= la; j++ {
		matrix[0][j] = j
	}
	for i := 1; i <= lb; i++ {
		for j := 1; j <= la; j++ {
			if br[i-1] == ar[j-1] {
				matrix[i][j] = matrix[i-1][j-1]
			} else {
				m := matrix[i-1][j-1]
				if matrix[i][j-1] < m {
					m = matrix[i][j-1]
				}
				if matrix[i-1][j] < m {
					m = matrix[i-1][j]
				}
				matrix[i][j] = m + 1
			}
		}
	}
	return matrix[lb][la]
}

// NearestResult — hasil pencarian tetangga terdekat.
type NearestResult struct {
	Closest  string `json:"closest"`
	Distance int    `json:"distance"`
}

// FindNearest — cari nama di candidates yang paling dekat dengan name.
// Return { closest: "", distance: -1 } kalau candidates kosong.
func FindNearest(name string, candidates []string) NearestResult {
	if len(candidates) == 0 {
		return NearestResult{Closest: "", Distance: -1}
	}
	minDist := -1
	closest := ""
	for _, c := range candidates {
		d := LevenshteinDistance(name, c)
		if minDist == -1 || d < minDist {
			minDist = d
			closest = c
		}
	}
	return NearestResult{Closest: closest, Distance: minDist}
}
