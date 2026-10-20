// tests/test-orchestrator-plan.mjs — Verifikasi M15: protokol delegasi JSON.
// parsePlan / validatePlan / plan (plan pakai askFn mock, tanpa network).
// Written by K-sRouter

import { parsePlan, validatePlan, plan, MAX_PLAN_TASKS } from '../src/orchestrator.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

// CATATAN: brief harus >= 15 char dan kata kerja di depan. Sejak M22, validator
// nolak brief yang cuma formalitas ('x', 'riset'), karena worker yang dikasih
// brief sependek itu bakal nanya-nanya sendiri dan hasilnya ngawur.
const VALID = { tasks: [{ id: 1, role: 'researcher', brief: 'Riset cara kerja debounce di JavaScript', dependsOn: null }] };

console.log('\n[1] parsePlan — ekstrak JSON dari output kotor');
check('JSON polos', parsePlan(JSON.stringify(VALID)).tasks.length === 1);
check('dibungkus fence ```json', parsePlan('```json\n' + JSON.stringify(VALID) + '\n```').tasks.length === 1);
check('dibungkus fence ``` biasa', parsePlan('```\n' + JSON.stringify(VALID) + '\n```').tasks.length === 1);
check('ada prose sebelum JSON', parsePlan('Berikut rencananya:\n' + JSON.stringify(VALID)).tasks.length === 1);
check('ada prose sesudah JSON', parsePlan(JSON.stringify(VALID) + '\nSemoga membantu!').tasks.length === 1);
check('prose sebelum & sesudah', parsePlan('Oke.\n' + JSON.stringify(VALID) + '\nSelesai.').tasks.length === 1);
check('thinking tag dibuang', parsePlan('<think>jangan pakai bash\n' + JSON.stringify(VALID)).tasks.length === 1);
check('array polos juga kebaca', parsePlan('[{"id":1,"role":"coder","brief":"x","dependsOn":null}]').length === 1);
check('JSON invalid melempar', throws(() => parsePlan('{tasks: [kurang kutip]}')));
check('tanpa JSON sama sekali melempar', throws(() => parsePlan('Saya tidak bisa memecah task ini.')));
check('string kosong melempar', throws(() => parsePlan('')));
check('non-string melempar', throws(() => parsePlan(null)));

console.log('\n[2] validatePlan — cek silang ke registry AGENTS');
check('rencana valid -> tanpa masalah', validatePlan(VALID).length === 0);
check('objek dengan 2 task valid', validatePlan({ tasks: [
  { id: 1, role: 'researcher', brief: 'Riset cara kerja debounce di JavaScript', dependsOn: null },
  { id: 2, role: 'coder', brief: 'Implementasikan fungsi debounce di src/debounce.js', dependsOn: 1 },
] }).length === 0);
check('bukan objek -> masalah', validatePlan('string').length > 0);
check('array -> masalah', validatePlan([VALID]).length > 0);
check('tasks kosong -> masalah', validatePlan({ tasks: [] }).length > 0);
check('tasks bukan array -> masalah', validatePlan({ tasks: 'x' }).length > 0);

const badRole = { tasks: [{ id: 1, role: 'architect', brief: 'x', dependsOn: null }] };
check('role ngawang -> masalah & nyebut role valid',
  validatePlan(badRole).some(p => p.includes('architect') && p.includes('researcher')));

const noBrief = { tasks: [{ id: 1, role: 'coder', brief: '', dependsOn: null }] };
check('brief kosong -> masalah', validatePlan(noBrief).some(p => p.includes('brief')));

const noId = { tasks: [{ role: 'coder', brief: 'x', dependsOn: null }] };
check('id hilang -> masalah', validatePlan(noId).some(p => p.includes('"id"')));

const dupId = { tasks: [
  { id: 1, role: 'coder', brief: 'a', dependsOn: null },
  { id: 1, role: 'coder', brief: 'b', dependsOn: null },
] };
check('id duplikat -> masalah', validatePlan(dupId).some(p => p.includes('duplikat')));

const badDep = { tasks: [{ id: 1, role: 'coder', brief: 'x', dependsOn: 99 }] };
check('dependsOn id ngawang -> masalah', validatePlan(badDep).some(p => p.includes('99')));

const selfDep = { tasks: [{ id: 1, role: 'coder', brief: 'x', dependsOn: 1 }] };
check('dependsOn diri sendiri -> masalah', validatePlan(selfDep).some(p => p.includes('sendiri')));

const tooMany = { tasks: Array.from({ length: MAX_PLAN_TASKS + 1 }, (_, i) => (
  { id: i + 1, role: 'coder', brief: 't', dependsOn: null }
)) };
check(`task melebihi ${MAX_PLAN_TASKS} -> masalah`, validatePlan(tooMany).some(p => p.includes('melebihi')));

console.log('\n[3] plan() — retry dengan feedback (pakai askFn mock, tanpa network)');
const okPlan = async () => {
  const r = await plan('riset lalu kode', async () => JSON.stringify(VALID));
  check('rencana valid -> ok:true, attempts:1', r.ok && r.attempts === 1 && r.tasks.length === 1);
};
await okPlan();

// attempt 1: role ngawang (invalid). attempt 2: valid. Retry harus jalan + kirim feedback.
const seenPrompts = [];
const retryPlan = await plan('riset lalu kode', async (sys, usr) => {
  seenPrompts.push(usr);
  return seenPrompts.length === 1
    ? JSON.stringify({ tasks: [{ id: 1, role: 'architect', brief: 'Bikin arsitektur modul pembayaran', dependsOn: null }] })
    : JSON.stringify(VALID);
});
check('attempt 1 invalid -> attempt 2 valid (ok:true)', retryPlan.ok && retryPlan.attempts === 2);
check('feedback dikirim ke LLM di percobaan ke-2',
  seenPrompts.length === 2 && seenPrompts[1].includes('TIDAK VALID') && seenPrompts[1].includes('architect'));

// selalu gagal -> ok:false + masalah terakhir
const alwaysBad = await plan('x', async () => JSON.stringify(badRole), { maxAttempts: 2 });
check('selalu invalid -> ok:false + masalah role', !alwaysBad.ok && alwaysBad.problems.some(p => p.includes('architect')));

// output LLM bukan JSON sama sekali -> ok:false, gak crash
const notJson = await plan('x', async () => 'maaf saya tidak bisa', { maxAttempts: 1 });
check('output bukan JSON -> ok:false tanpa crash', !notJson.ok && notJson.problems.length > 0);

console.log(`\n=== HASIL M15: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
