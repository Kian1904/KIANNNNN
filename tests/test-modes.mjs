// tests/test-modes.mjs — Kontrak mode approval (SAFE / WELL-WELL / YOLO).
//
// Yang dites:
//   - normalizeMode: alias + case + input sampah
//   - decide(): matriks keputusan tiap mode x (destruktif / bukan)
//   - INVARIANT PENTING: SAFE & WELL-WELL TIDAK PERNAH auto-approve destruktif
//   - askApproval REPL: YOLO skip prompt, WELL-WELL nanya buat destruktif,
//     SAFE nanya buat semua
//   - askApproval Telegram: aturan sama (biar gak beda perilaku)
//
// Written by K-sRouter

import { MODES, DESTRUCTIVE_ACTIONS, normalizeMode, decide, MODE_DESCRIPTIONS } from '../src/modes.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

console.log('\n[1] normalizeMode');
check('safe → safe', normalizeMode('safe') === MODES.SAFE);
check('SAFE (kapital) → safe', normalizeMode('SAFE') === MODES.SAFE);
check('  safe  (spasi) → safe', normalizeMode('  safe  ') === MODES.SAFE);
check('wellwell → wellwell', normalizeMode('wellwell') === MODES.WELLWELL);
check('well-well → wellwell', normalizeMode('well-well') === MODES.WELLWELL);
check('ww (singkatan) → wellwell', normalizeMode('ww') === MODES.WELLWELL);
check('yolo → yolo', normalizeMode('yolo') === MODES.YOLO);
check('terabas → yolo', normalizeMode('terabas') === MODES.YOLO);
check('input sampah → null', normalizeMode('ngawur') === null);
check('kosong → null', normalizeMode('') === null);
check('undefined → null', normalizeMode(undefined) === null);

console.log('\n[2] DESTRUCTIVE_ACTIONS');
check('delete termasuk destruktif', DESTRUCTIVE_ACTIONS.has('delete'));
check('rename termasuk destruktif', DESTRUCTIVE_ACTIONS.has('rename'));
check('move termasuk destruktif', DESTRUCTIVE_ACTIONS.has('move'));
check('remove termasuk destruktif', DESTRUCTIVE_ACTIONS.has('remove'));
check('edit BUKAN destruktif', !DESTRUCTIVE_ACTIONS.has('edit'));

console.log('\n[3] decide() — matriks keputusan');
// SAFE
check('SAFE + edit → gak auto', decide(MODES.SAFE, { action: 'edit' }).auto === false);
check('SAFE + destruktif → gak auto', decide(MODES.SAFE, { action: 'delete', isDestructive: true }).auto === false);
// WELL-WELL
check('WELLWELL + edit → auto approve', decide(MODES.WELLWELL, { action: 'edit' }).auto === true
  && decide(MODES.WELLWELL, { action: 'edit' }).approved === true);
check('WELLWELL + bash biasa → auto approve', decide(MODES.WELLWELL, { action: 'bash', isDestructive: false }).auto === true);
check('WELLWELL + delete → TETAP NANYA', decide(MODES.WELLWELL, { action: 'delete', isDestructive: true }).auto === false);
check('WELLWELL + rm (forceAsk) → TETAP NANYA', decide(MODES.WELLWELL, { action: 'bash', isDestructive: true }).auto === false);
// YOLO
check('YOLO + edit → auto approve', decide(MODES.YOLO, { action: 'edit' }).auto === true);
check('YOLO + delete → auto approve', decide(MODES.YOLO, { action: 'delete', isDestructive: true }).auto === true);
check('YOLO + rm → auto approve', decide(MODES.YOLO, { action: 'bash', isDestructive: true }).auto === true);

console.log('\n[4] INVARIANT: mode gak dikenal → jatuh ke SAFE (fail-closed)');
const unknown = decide('mode-ngawur', { action: 'edit' });
check('mode ngawur → gak auto approve', unknown.auto === false, JSON.stringify(unknown));
check('mode undefined → gak auto approve', decide(undefined, { action: 'edit' }).auto === false);

console.log('\n[5] INVARIANT KRITIS: SAFE & WELL-WELL gak boleh auto destruktif');
for (const m of [MODES.SAFE, MODES.WELLWELL]) {
  for (const act of ['delete', 'rename', 'move', 'remove']) {
    const r = decide(m, { action: act, isDestructive: true });
    check(`${m} + ${act} → wajib nanya`, r.auto === false, JSON.stringify(r));
  }
}

console.log('\n[6] MODE_DESCRIPTIONS lengkap');
check('ada deskripsi safe', typeof MODE_DESCRIPTIONS[MODES.SAFE] === 'string' && MODE_DESCRIPTIONS[MODES.SAFE].length > 0);
check('ada deskripsi wellwell', typeof MODE_DESCRIPTIONS[MODES.WELLWELL] === 'string' && MODE_DESCRIPTIONS[MODES.WELLWELL].length > 0);
check('ada deskripsi yolo', typeof MODE_DESCRIPTIONS[MODES.YOLO] === 'string' && MODE_DESCRIPTIONS[MODES.YOLO].length > 0);

console.log('\n[7] Integrasi askApproval REPL (mode dibaca dari env)');
{
  process.env.K_SROUTER_MODE = 'yolo';
  // repl.js adalah CLI yang langsung jalan; kita baca sumbernya buat mastiin
  // mode gate beneran kepasang di askApproval (bukan cuma di modul modes.js).
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');
  check('repl.js import decide()', /import\s*\{[^}]*decide[^}]*\}\s*from\s*'\.\/modes\.js'/.test(src));
  check('repl.js panggil decide di askApproval', /const verdict = decide\(approvalMode/.test(src));
  check('repl.js punya state approvalMode', /let approvalMode = normalizeMode/.test(src));
  check('repl.js punya command /mode', /startsWith\('\/mode'\)/.test(src));
  check('repl.js /mode yolo kasih warning', /YOLO AKTIF/.test(src));

  const tg = fs.readFileSync(new URL('../src/telegram-bot.js', import.meta.url), 'utf8');
  check('telegram-bot.js import decide()', /import\s*\{[^}]*decide[^}]*\}\s*from\s*'\.\/modes\.js'/.test(tg));
  check('telegram-bot.js panggil decide di makeAskApproval', /const verdict = decide\(approvalMode/.test(tg));
  check('telegram-bot.js punya state approvalMode', /let approvalMode = normalizeMode/.test(tg));
  check('telegram-bot.js punya command /mode', /cmd === 'mode'/.test(tg));
  delete process.env.K_SROUTER_MODE;
}

console.log('\n[8] Konsistensi REPL vs Telegram (aturan satu sumber)');
{
  const fs = await import('node:fs');
  const repl = fs.readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');
  const tg = fs.readFileSync(new URL('../src/telegram-bot.js', import.meta.url), 'utf8');
  // Dua-duanya harus pakai DESTRUCTIVE_ACTIONS dari modes.js, bukan bikin set sendiri.
  check('repl.js pakai DESTRUCTIVE_ACTIONS dari modes.js', /DESTRUCTIVE_ACTIONS\.has/.test(repl));
  check('telegram-bot.js pakai DESTRUCTIVE_ACTIONS dari modes.js', /DESTRUCTIVE_ACTIONS\.has/.test(tg));
  check('dua-duanya nge-import dari modes.js', /from '\.\/modes\.js'/.test(repl) && /from '\.\/modes\.js'/.test(tg));
}

console.log(`\n=== HASIL MODES: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
