
import { showDiff } from '../src/diff.js';

let pass = 0, fail = 0;
const check = (l, c, extra = '') => c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l + (extra ? ' — ' + extra : '')));

// 1. INSERT di tengah file panjang — baris setelahnya TIDAK boleh ke-flag
const old1 = Array.from({ length: 50 }, (_, i) => 'baris-' + i).join('\n');
const new1 = Array.from({ length: 51 }, (_, i) => i === 25 ? 'BARIS-BARU' : 'baris-' + (i > 25 ? i - 1 : i)).join('\n');
const d1 = showDiff(old1, new1);
const changed = d1.split('\n').filter(l => l.startsWith('+ ') || l.startsWith('- '));
check('insert di tengah: cuma 1 baris berubah (murni insert, tanpa -)', changed.length === 1, `dapet ${changed.length}: ${JSON.stringify(changed)}`);
check('insert di tengah: yang + adalah baris baru', changed.some(l => l === '+ BARIS-BARU'));

// 2. DELETE satu baris
const d2 = showDiff(old1, old1.split('\n').filter((_, i) => i !== 10).join('\n'));
const ch2 = d2.split('\n').filter(l => l.startsWith('+ ') || l.startsWith('- '));
check('delete 1 baris: cuma 1-', ch2.length === 1 && ch2[0] === '- baris-10', JSON.stringify(ch2));

// 3. IDENTIK
check('identik -> "(tidak ada perbedaan)"', showDiff('a\nb', 'a\nb') === '(tidak ada perbedaan)');

// 4. FILE BARU (old kosong)
const d4 = showDiff('', 'baris1\nbaris2');
check('file baru: semua +, header -0,0', d4.includes('@@ -0,0 +1,2 @@') && d4.split('\n').filter(l => l.startsWith('+ ')).length === 2, d4);

// 5. old non-kosong vs new kosong (hapus isi file)
const d5 = showDiff('x\ny', '');
check('hapus isi: semua -', d5.split('\n').filter(l => l.startsWith('- ')).length === 2 && d5.includes('@@ -1,2 +0,0 @@'), d5);

// 6. Edit di awal + akhir (prefix/suffix trim tetap bener)
const d6 = showDiff('a\nb\nc\nd\ne', 'A\nb\nc\nd\nE');
const ch6 = d6.split('\n').filter(l => l.startsWith('+ ') || l.startsWith('- '));
check('edit awal+akhir: 2 pasang', ch6.length === 4, JSON.stringify(ch6));
check('edit awal+akhir: konteks b,c,d kebaca context', d6.includes('  b'));

// 7. Hunk header validitas: line number setelah insert
const d7 = showDiff('a\nb\nc', 'a\nX\nb\nc');
check('header hunk insert: -1,3 +1,4', d7.includes('@@ -1,3 +1,4 @@'), d7.split('\n')[0]);

// 8. Gaya git: content identik tapi beda newline ending
check('trailing newline beda ditangani (tidak crash)', typeof showDiff('a\n', 'a') === 'string');

// 9. File besar beda total (block-replace path) — gak crash, output lengkap
const big1 = Array.from({ length: 4000 }, (_, i) => 'LAMA-' + i).join('\n');
const big2 = Array.from({ length: 4000 }, (_, i) => 'BARU-' + i).join('\n');
const t0 = Date.now();
const d9 = showDiff(big1, big2);
const ms = Date.now() - t0;
check(`file 4000 baris beda total: lengkap & cepat (${ms}ms)`,
  d9.split('\n').filter(l => l.startsWith('- ')).length === 4000 &&
  d9.split('\n').filter(l => l.startsWith('+ ')).length === 4000 && ms < 3000);

// 10. File besar edit kecil (trim + Myers path)
const bigA = Array.from({ length: 5000 }, (_, i) => 'baris-' + i).join('\n');
const bigB = Array.from({ length: 5000 }, (_, i) => i === 4000 ? 'UBAHAN' : 'baris-' + i).join('\n');
const d10 = showDiff(bigA, bigB);
const ch10 = d10.split('\n').filter(l => l.startsWith('+ ') || l.startsWith('- '));
check('file 5000 baris edit 1: cuma 1 pasang', ch10.length === 2, `dapet ${ch10.length}`);

console.log(`\n=== HASIL DIFF TEST: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
