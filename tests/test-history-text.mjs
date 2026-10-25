// M50 REGRESI: buildHistoryText wajib menampilkan user_condition & note.
// Bug: keduanya jatuh ke cabang `!approved` dan tercetak sebagai
// `BASH "undefined" — DITOLAK user`, sehingga hint recovery tidak sampai ke model.
import { buildHistoryText } from '../src/plan.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

{
  const out = buildHistoryText([{ action: 'user_condition', condition: '[RECOVERY: test gagal] Baca output test.' }]);
  check('user_condition: muncul sebagai USER CONDITION', /USER CONDITION/.test(out), out);
  check('user_condition: isi hint ikut tercetak', /RECOVERY: test gagal/.test(out), out);
  check('user_condition: TIDAK tercetak sebagai DITOLAK user', !/DITOLAK user/.test(out), out);
  check('user_condition: TIDAK ada "undefined"', !/undefined/.test(out), out);
}
{
  const out = buildHistoryText([{ action: 'note', text: 'recovery bash: retry (test_failure)' }]);
  check('note: tercetak sebagai CATATAN', /CATATAN/.test(out), out);
  check('note: isi tercetak', /recovery bash/.test(out), out);
  check('note: tidak dianggap penolakan', !/DITOLAK user/.test(out), out);
}
{
  const out = buildHistoryText([{ action: 'bash', command: 'rm -rf /', approved: false }]);
  check('penolakan asli tetap tercetak sebagai DITOLAK user', /DITOLAK user/.test(out), out);
  check('penolakan asli menyebut command-nya', /rm -rf/.test(out), out);
  check('penolakan asli tanpa "undefined"', !/undefined/.test(out), out);
}
{
  const out = buildHistoryText([{ action: 'edit', target: 'a.js', approved: false }]);
  check('penolakan non-bash tidak menghasilkan "BASH undefined"', !/BASH "undefined"/.test(out), out);
}

console.log(`\n=== HASIL HISTORY-TEXT: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
