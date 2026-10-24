// M44 RED: internal checklist + verifier gate sebelum done diterima.
import { createTaskState, allCompleted } from '../src/task-state.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const state = createTaskState([
  { id: 't1', description: 'baca file config' },
  { id: 't2', description: 'edit handler login' },
  { id: 't3', description: 'jalankan test' },
]);

check('state awal semua pending', state.items.length === 3 && state.items.every(i => i.status === 'pending'));
check('allCompleted false kalau masih pending', allCompleted(state) === false);

state.markDone('t1');
check('markDone ubah status ke completed', state.items.find(i => i.id === 't1').status === 'completed');
check('allCompleted false kalau baru 1 dari 3', allCompleted(state) === false);

state.markDone('t2');
state.markDone('t3');
check('allCompleted true setelah semua done', allCompleted(state) === true);

check('markDone id tidak dikenal tidak crash', (() => { try { state.markDone('ghost'); return true; } catch { return false; } })());

const empty = createTaskState([]);
check('empty checklist dianggap completed (tidak ada kerjaan)', allCompleted(empty) === true);

console.log(`\n=== HASIL TASK-STATE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
