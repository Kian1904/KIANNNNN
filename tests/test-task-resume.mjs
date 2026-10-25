// M49 RED: resume + crash recovery dari journal.
// Resume harus: tidak mengulang aksi yang sudah verified, tahu apa yang belum,
// dan menolak resume task yang sudah terminal.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TASK_STATUS, createJournal, appendEntry, readJournal, replayJournal,
  canTransition, isTerminalStatus,
} from '../src/task-journal.js';
import { planResume, isResumable, buildResumeInstruction } from '../src/task-resume.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m49-'));

function makeTask(taskId, entries) {
  const j = createJournal({ dir: tmpDir, taskId, goal: 'bikin fitur X', status: TASK_STATUS.RUNNING });
  for (const e of entries) appendEntry(j, e);
  return j.path;
}

// ── [1] isResumable ─────────────────────────────────────────────────────────
{
  const running = makeTask('t-running', [{ type: 'status', status: TASK_STATUS.RUNNING }]);
  check('resumable: running bisa di-resume', isResumable(running) === true);

  const paused = makeTask('t-paused', [{ type: 'status', status: TASK_STATUS.PAUSED }]);
  check('resumable: paused bisa di-resume', isResumable(paused) === true);

  const completed = makeTask('t-done', [{ type: 'status', status: TASK_STATUS.COMPLETED }]);
  check('resumable: completed TIDAK bisa di-resume', isResumable(completed) === false);

  const cancelled = makeTask('t-cancel', [{ type: 'status', status: TASK_STATUS.CANCELLED }]);
  check('resumable: cancelled TIDAK bisa di-resume', isResumable(cancelled) === false);

  check('resumable: file tidak ada -> false', isResumable(path.join(tmpDir, 'ghost.jsonl')) === false);
  check('resumable: null -> false', isResumable(null) === false);
}

// ── [2] planResume: apa yang sudah & belum dikerjakan ───────────────────────
{
  const p = makeTask('t-plan', [
    { type: 'status', status: TASK_STATUS.RUNNING },
    { type: 'action', action: 'read', target: 'src/a.js', verified: true },
    { type: 'action', action: 'edit', target: 'src/a.js', verified: true },
    { type: 'action', action: 'bash', command: 'npm test', verified: false, error: 'exit 1' },
    { type: 'acceptance', id: 'ac-1', status: 'completed', evidence: 'file ada' },
    { type: 'acceptance', id: 'ac-2', status: 'pending' },
  ]);
  const plan = planResume(p);

  check('planResume: canResume true', plan.canResume === true);
  check('planResume: status terbaca', plan.status === TASK_STATUS.RUNNING);
  check('planResume: goal terbaca', plan.goal === 'bikin fitur X');
  check('planResume: aksi verified terdaftar', plan.completedActions.length === 2);
  check('planResume: aksi gagal terdaftar sebagai unfinished', plan.failedActions.length === 1);
  check('planResume: kriteria terpenuhi terbaca', plan.metCriteria.includes('ac-1'));
  check('planResume: kriteria pending terbaca', plan.pendingCriteria.includes('ac-2'));
  check('planResume: next step menunjuk kegagalan sebelumnya', plan.nextStep.some(s => /npm test/.test(s)), JSON.stringify(plan.nextStep));
  check('planResume: next step menyertakan kriteria pending', plan.nextStep.some(s => /ac-2/.test(s)), JSON.stringify(plan.nextStep));
  check('planResume: tidak menyarankan ulang aksi yang sudah verified',
    !plan.nextStep.some(s => /edit src\/a\.js/.test(s)), JSON.stringify(plan.nextStep));
}
{
  const p = makeTask('t-done2', [{ type: 'status', status: TASK_STATUS.COMPLETED }]);
  const plan = planResume(p);
  check('planResume: task completed -> canResume false', plan.canResume === false);
  check('planResume: task completed kasih alasan', typeof plan.reason === 'string' && plan.reason.length > 0);
}
{
  const plan = planResume(path.join(tmpDir, 'ghost.jsonl'));
  check('planResume: file tidak ada -> canResume false', plan.canResume === false);
  check('planResume: file tidak ada tidak crash', typeof plan === 'object');
}

// ── [3] buildResumeInstruction ──────────────────────────────────────────────
{
  const p = makeTask('t-instr', [
    { type: 'status', status: TASK_STATUS.RUNNING },
    { type: 'action', action: 'edit', target: 'src/b.js', verified: true },
    { type: 'action', action: 'bash', command: 'npm test', verified: false, error: 'exit 1' },
  ]);
  const plan = planResume(p);
  const instr = buildResumeInstruction(plan);

  check('instruction: memuat goal', /fitur X/.test(instr));
  check('instruction: menyebut kerja yang SUDAH selesai', /src\/b\.js/.test(instr));
  check('instruction: menyebut kegagalan sebelumnya', /npm test|exit 1/.test(instr));
  check('instruction: melarang mengulang dari nol', /jangan ulang|sudah selesai|jangan mengulang/i.test(instr));
  check('instruction: bukan string kosong', instr.trim().length > 40);
}
{
  const instr = buildResumeInstruction(planResume(path.join(tmpDir, 'ghost.jsonl')));
  check('instruction: plan tidak valid -> string kosong/aman', typeof instr === 'string');
}

// ── [4] Transisi status untuk pause/resume ──────────────────────────────────
check('transition: running -> paused sah', canTransition(TASK_STATUS.RUNNING, TASK_STATUS.PAUSED) === true);
check('transition: paused -> running sah', canTransition(TASK_STATUS.PAUSED, TASK_STATUS.RUNNING) === true);
check('transition: paused -> cancelled sah', canTransition(TASK_STATUS.PAUSED, TASK_STATUS.CANCELLED) === true);
check('transition: completed terminal', isTerminalStatus(TASK_STATUS.COMPLETED));

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
console.log(`\n=== HASIL TASK-RESUME: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
