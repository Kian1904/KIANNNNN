// src/diff.js — Line diff: prefix/suffix trim + Myers O(ND) + hunk context 3.
// Mengganti parallel line comparison lama (lihat FINDING "Diff tidak akurat
// untuk file besar"): baris yang di-insert/delete di tengah kini TIDAK bikin
// seluruh file bergeser dan ke-flag semua.
//
// Written by K'

const CTX = 3;        // baris context per hunk
const MAX_MYERS = 3000; // batas baris sisa (pasca-trim) utk pakai Myers
const MAX_D = 500;      // batas edit distance — jaga memory O(D*(N+M)) di HP

/** '' = 0 baris (konvensi git), selain itu split per baris. */
function toLines(s) {
  return s === '' ? [] : String(s).split('\n');
}

/**
 * Myers greedy O(ND) ala Coglan: trace V per d, lalu backtrack.
 * @returns {Array<{type:'='|'-'|'+', a?:number, b?:number}>} ops relatif ke input
 */
function myers(a, b) {
  const N = a.length, M = b.length;
  const MAX = N + M;
  const offset = MAX;
  const v = new Int32Array(2 * MAX + 1);
  const trace = [];

  for (let d = 0; d <= MAX && d <= MAX_D; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        return backtrack(trace, a, b, offset);
      }
    }
  }
  return null; // melebihi MAX_D / gagal — pemanggil fallback block-replace
}

function backtrack(trace, a, b, offset) {
  let x = a.length, y = b.length;
  const ops = [];
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: '=', a: x - 1, b: y - 1 });
      x--; y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ type: '+', b: prevY });
      else ops.push({ type: '-', a: prevX });
      x = prevX; y = prevY;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * Diff dua konten teks.
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {string} unified diff dgn hunk '@@' (context 3), atau pesan tanpa perbedaan
 */
export function showDiff(oldContent, newContent) {
  const oldLines = toLines(oldContent);
  const newLines = toLines(newContent);

  // Trim common prefix & suffix — potong sisanya jadi kecil utk kasus edit lokal
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;

  const aMid = oldLines.slice(prefix, oldLines.length - suffix);
  const bMid = newLines.slice(prefix, newLines.length - suffix);

  if (aMid.length === 0 && bMid.length === 0) {
    return '(tidak ada perbedaan)';
  }

  // Sisa terlalu besar utk Myers (memory) → block-replace: akurat (memang semua
  // beda setelah trim), tanpa risiko OOM di Termux.
  let midOps = null;
  if (aMid.length + bMid.length <= MAX_MYERS) {
    midOps = myers(aMid, bMid);
  }
  if (midOps === null) {
    midOps = [
      ...aMid.map((_, i) => ({ type: '-', a: i })),
      ...bMid.map((_, i) => ({ type: '+', b: i })),
    ];
  }

  // Gabung full ops: prefix yang sama + tengah (di-shift) + suffix yang sama
  const full = [];
  for (let i = 0; i < prefix; i++) full.push({ type: '=', a: i, b: i });
  for (const op of midOps) {
    if (op.type === '=') full.push({ type: '=', a: prefix + op.a, b: prefix + op.b });
    else if (op.type === '-') full.push({ type: '-', a: prefix + op.a });
    else full.push({ type: '+', b: prefix + op.b });
  }
  for (let i = 0; i < suffix; i++) {
    full.push({ type: '=', a: oldLines.length - suffix + i, b: newLines.length - suffix + i });
  }

  // Kelompokkan jadi hunk: gabung gap perubahan <= 2*CTX
  const changeIdx = [];
  full.forEach((op, i) => { if (op.type !== '=') changeIdx.push(i); });

  const groups = [];
  for (const i of changeIdx) {
    const last = groups[groups.length - 1];
    if (last && i - last.end <= CTX * 2) last.end = i;
    else groups.push({ start: i, end: i });
  }

  const out = [];
  for (const g of groups) {
    const from = Math.max(0, g.start - CTX);
    const to = Math.min(full.length - 1, g.end + CTX);

    // Hitung nomor baris awal hunk (1-based)
    let aNum = 0, bNum = 0;
    for (let i = 0; i < from; i++) {
      if (full[i].type !== '+') aNum++;
      if (full[i].type !== '-') bNum++;
    }
    let aCount = 0, bCount = 0;
    const body = [];
    for (let i = from; i <= to; i++) {
      const op = full[i];
      if (op.type === '=') { body.push('  ' + oldLines[op.a]); aCount++; bCount++; }
      else if (op.type === '-') { body.push('- ' + oldLines[op.a]); aCount++; }
      else { body.push('+ ' + newLines[op.b]); bCount++; }
    }
    const aStart = aCount === 0 ? aNum : aNum + 1;   // git convention: count=0 -> start = baris sebelum
    const bStart = bCount === 0 ? bNum : bNum + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    out.push(...body);
  }

  return out.join('\n');
}
