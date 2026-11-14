// M52: oracle indexer JS vs Go — hasil harus IDENTIK.
import { collectFiles, buildIndex, buildIndexAsync, findSymbol, goBridgeStatus } from '../src/indexer.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const status = goBridgeStatus();
console.log(`  (bridge Go: ${status.available ? 'tersedia' : 'TIDAK ADA — fallback JS'})`);

// Index codebase nyata (src/)
const files = collectFiles('src');
console.log(`  (file di-index: ${files.length})`);
check('collectFiles dapat file', files.length > 50);

const js = buildIndex(files);
const go = await buildIndexAsync(files);

check('files sama', js.files === go.files);
check('totalLines sama', js.totalLines === go.totalLines);
check('jumlah simbol sama', js.symbols.length === go.symbols.length);

// Bandingkan simbol satu-satu (urutan harus sama)
let mismatch = 0;
const n = Math.min(js.symbols.length, go.symbols.length);
for (let i = 0; i < n; i++) {
  const a = js.symbols[i], b = go.symbols[i];
  if (a.kind !== b.kind || a.name !== b.name || a.file !== b.file || a.line !== b.line) {
    if (mismatch < 3) console.log(`    beda #${i}: JS=${JSON.stringify(a)} Go=${JSON.stringify(b)}`);
    mismatch++;
  }
}
check(`semua simbol identik (${n} dicek)`, mismatch === 0);

// findSymbol
const q = 'build';
const jsFind = findSymbol(js.symbols, q);
const goFind = go.symbols.filter(s => s.name.toLowerCase().includes(q));
check(`findSymbol('${q}') sama`, jsFind.length === goFind.length);

console.log(`\n=== HASIL GO-INDEX: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
