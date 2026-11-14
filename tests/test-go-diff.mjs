// M49: oracle diff JS vs Go — hasil harus IDENTIK untuk semua kasus.
import { showDiff, showDiffAsync, goBridgeStatus } from '../src/diff.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const status = goBridgeStatus();
console.log(`  (bridge Go: ${status.available ? 'tersedia' : 'TIDAK ADA — fallback JS'})`);

const cases = [
  ['identik', 'a\nb\nc', 'a\nb\nc'],
  ['kosong dua-duanya', '', ''],
  ['ubah tengah', 'a\nb\nc', 'a\nX\nc'],
  ['insert tengah', '1\n2\n3\n4\n5', '1\n2\nBARU\n3\n4\n5'],
  ['delete tengah', '1\n2\n3\n4\n5', '1\n2\n4\n5'],
  ['kosong → isi', '', 'a\nb'],
  ['isi → kosong', 'a\nb', ''],
  ['prefix/suffix sama', 'same1\nsame2\nOLD\nsame3\nsame4', 'same1\nsame2\nNEW\nsame3\nsame4'],
  ['tambah di akhir', 'a\nb', 'a\nb\nc'],
  ['hapus di awal', 'a\nb\nc', 'b\nc'],
  ['dua hunk berjauhan', Array.from({length:40},(_,i)=>'L'+(i+1)).join('\n'), (() => { const l = Array.from({length:40},(_,i)=>'L'+(i+1)); l[2]='X'; l[35]='Y'; return l.join('\n'); })()],
  ['fallback besar (>3000)', Array.from({length:2000},(_,i)=>'a'+i).join('\n'), Array.from({length:2000},(_,i)=>'b'+i).join('\n')],
  ['baris kosong di tengah', 'a\n\nb', 'a\n\nX\nb'],
  ['trailing newline', 'a\nb\n', 'a\nc\n'],
  ['satu baris', 'x', 'y'],
];

for (const [name, oldC, newC] of cases) {
  const js = showDiff(oldC, newC);
  const go = await showDiffAsync(oldC, newC);
  check(`${name}: identik`, js === go);
  if (js !== go) {
    console.log(`    JS: ${JSON.stringify(js.slice(0, 120))}`);
    console.log(`    Go: ${JSON.stringify(go.slice(0, 120))}`);
  }
}

console.log(`\n=== HASIL GO-DIFF: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
