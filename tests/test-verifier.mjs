// M24: post-action verification — "done" harus punya bukti.
import { verifyAction, verifyCompletion } from '../src/verifier.js';

let pass = 0, fail = 0;
const check = (label, cond) => cond ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));

console.log('\n[1] bukti action');
check('edit sukses + file benar -> verified', verifyAction({ action: 'edit', target: 'x.js', expectedContent: 'ok', actualContent: 'ok' }).ok);
check('edit sukses tapi isi beda -> gagal', !verifyAction({ action: 'edit', target: 'x.js', expectedContent: 'ok', actualContent: 'oops' }).ok);
check('edit target hilang -> gagal', !verifyAction({ action: 'edit', target: 'x.js', expectedContent: 'ok', actualContent: null }).ok);
check('bash exit 0 -> verified', verifyAction({ action: 'bash', result: { ok: true, code: 0 } }).ok);
check('bash exit nonzero -> gagal', !verifyAction({ action: 'bash', result: { ok: false, code: 2 } }).ok);
check('web fetch isi ada -> verified', verifyAction({ action: 'web_fetch', text: 'data BMKG' }).ok);
check('web fetch kosong -> gagal', !verifyAction({ action: 'web_fetch', text: '' }).ok);

console.log('\n[2] completion gate');
check('done tanpa aksi untuk jawaban informasional -> boleh', verifyCompletion([], 'Penjelasan singkat.').ok);
check('summary kosong -> ditolak', !verifyCompletion([], '').ok);
check('ada edit gagal -> done ditolak', !verifyCompletion([{ action: 'edit', verified: false, error: 'isi beda' }], 'sudah selesai').ok);
check('ada edit verified -> done boleh', verifyCompletion([{ action: 'edit', verified: true }], 'sudah selesai').ok);
check('ada bash gagal -> done ditolak', !verifyCompletion([{ action: 'bash', verified: false }], 'sudah selesai').ok);
check('failure gate kasih alasan', verifyCompletion([{ action: 'bash', verified: false }], 'sudah selesai').reason.length > 0);

console.log(`\n=== HASIL VERIFIER: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
