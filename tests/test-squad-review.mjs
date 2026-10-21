// M27 RED/GREEN: final squad result wajib punya evidence reviewer.
import { reviewSquadResult } from '../src/squad-review.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const base = { results: [
  { id: 1, role: 'coder', summary: 'kode selesai', verified: true, evidence: ['node --check src/x.js: exit 0'] },
], finalSummary: 'kode selesai', originalInstruction: 'buat fitur x' };
check('hasil dengan evidence lolos', reviewSquadResult(base).ok);
check('hasil tanpa evidence ditolak', !reviewSquadResult({ ...base, results: [{ ...base.results[0], evidence: [] }] }).ok);
check('worker gagal ditolak', !reviewSquadResult({ ...base, results: [{ ...base.results[0], verified: false, error: 'test gagal' }] }).ok);
check('summary kosong ditolak', !reviewSquadResult({ ...base, finalSummary: '' }).ok);
check('reason menyebut evidence', /evidence|bukti/i.test(reviewSquadResult({ ...base, results: [{ ...base.results[0], evidence: [] }] }).reason));
console.log(`\n=== HASIL SQUAD-REVIEW: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
