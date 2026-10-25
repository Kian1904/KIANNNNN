// M48 RED: task journal + lifecycle state.
// Journal = append-only, crash-safe, tanpa secret. Lifecycle = state machine eksplisit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TASK_STATUS, isTerminalStatus, canTransition,
  createJournal, appendEntry, readJournal, replayJournal,
  taskSummaryFromJournal, listTaskFiles,
} from '../src/task-journal.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m48-'));

// ── [1] Status machine ──────────────────────────────────────────────────────
check('status: ada status lifecycle inti',
  ['queued','planning','awaiting_approval','running','blocked','retrying','verifying','completed','failed','cancelled','paused']
    .every(s => Object.values(TASK_STATUS).includes(s)));
check('status: completed terminal', isTerminalStatus(TASK_STATUS.COMPLETED) === true);
check('status: failed terminal', isTerminalStatus(TASK_STATUS.FAILED) === true);
check('status: cancelled terminal', isTerminalStatus(TASK_STATUS.CANCELLED) === true);
check('status: running bukan terminal', isTerminalStatus(TASK_STATUS.RUNNING) === false);
check('status: paused bukan terminal', isTerminalStatus(TASK_STATUS.PAUSED) === false);
check('transition: running -> completed boleh',
  canTransition(TASK_STATUS.RUNNING, TASK_STATUS.COMPLETED) === true);
check('transition: completed -> running DITOLAK (terminal tidak bisa dibangunkan)',
  canTransition(TASK_STATUS.COMPLETED, TASK_STATUS.RUNNING) === false);
check('transition: paused -> running boleh (resume)',
  canTransition(TASK_STATUS.PAUSED, TASK_STATUS.RUNNING) === true);
check('transition: queued -> completed DITOLAK (lompat status)',
  canTransition(TASK_STATUS.QUEUED, TASK_STATUS.COMPLETED) === false);

// ── [2] Journal append-only ─────────────────────────────────────────────────
{
  const j = createJournal({ dir: tmpDir, taskId: 'task-a', goal: 'bikin file a.js' });
  check('journal: path ada setelah create', fs.existsSync(j.path));
  check('journal: taskId tersimpan', j.entry.taskId === 'task-a');
  check('journal: status awal queued/running', [TASK_STATUS.QUEUED, TASK_STATUS.RUNNING].includes(j.entry.status));

  appendEntry(j, { type: 'status', status: TASK_STATUS.RUNNING });
  appendEntry(j, { type: 'action', action: 'write', target: 'a.js', verified: true });
  appendEntry(j, { type: 'verify', criteria: 'ac-1', ok: true, evidence: 'file ada' });

  const entries = readJournal(j.path);
  check('journal: 3 entry tambahan tercatat', entries.length >= 3, `dapat ${entries.length}`);
  check('journal: entry punya timestamp', entries.every(e => typeof e.at === 'string' && e.at.length > 0));
  check('journal: entry punya seq naik', entries.every((e, i, arr) => i === 0 || e.seq > arr[i - 1].seq));
  check('journal: status terakhir running',
    replayJournal(entries).status === TASK_STATUS.RUNNING);
}

// ── [3] Journal tidak menyimpan secret ──────────────────────────────────────
{
  const j = createJournal({ dir: tmpDir, taskId: 'task-secret', goal: 'test' });
  appendEntry(j, { type: 'action', action: 'bash', command: 'export API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456' });
  const raw = fs.readFileSync(j.path, 'utf8');
  check('journal: API key sk- di-redact', !/sk-[A-Za-z0-9]{20,}/.test(raw), raw.slice(0, 200));
  check('journal: token gsk_ di-redact', (() => {
    appendEntry(j, { type: 'note', text: 'token gsk_ABCDEFGHIJKLMNOPQRSTUVWX1234567' });
    return !/gsk_[A-Za-z0-9]{20,}/.test(fs.readFileSync(j.path, 'utf8'));
  })());
  check('journal: redact tetap menyisakan konteks',
    /API_KEY/.test(fs.readFileSync(j.path, 'utf8')));
}

// ── [4] Replay membangun state ──────────────────────────────────────────────
{
  const j = createJournal({ dir: tmpDir, taskId: 'task-replay', goal: 'g' });
  appendEntry(j, { type: 'status', status: TASK_STATUS.RUNNING });
  appendEntry(j, { type: 'action', action: 'edit', target: 'src/x.js', verified: true });
  appendEntry(j, { type: 'action', action: 'bash', command: 'npm test', verified: false, error: 'exit 1' });
  appendEntry(j, { type: 'acceptance', id: 'ac-1', status: 'completed', evidence: 'ok' });
  const state = replayJournal(readJournal(j.path));

  check('replay: status ikut entry terakhir', state.status === TASK_STATUS.RUNNING);
  check('replay: actions terkumpul', state.actions.length === 2, `dapat ${state.actions.length}`);
  check('replay: aksi gagal tetap tercatat', state.actions.some(a => a.verified === false));
  check('replay: acceptance terkumpul', state.acceptance['ac-1']?.status === 'completed');
  check('replay: lastAction menunjuk aksi terakhir', state.lastAction?.action === 'bash');
  check('replay: unverified dihitung', state.unverifiedCount === 1, `dapat ${state.unverifiedCount}`);
  check('replay: verified dihitung', state.verifiedCount === 1, `dapat ${state.verifiedCount}`);
}

// ── [5] Journal rusak tidak bikin crash ─────────────────────────────────────
{
  const p = path.join(tmpDir, 'task-corrupt.jsonl');
  fs.writeFileSync(p, '{"seq":1,"type":"status","status":"running","at":"x"}\nINI BUKAN JSON\n{"seq":3,"type":"action","action":"read","verified":true,"at":"y"}\n');
  const entries = readJournal(p);
  check('journal rusak: entry valid tetap kebaca', entries.length === 2, `dapat ${entries.length}`);
  check('journal rusak: tidak throw', true);
  const state = replayJournal(entries);
  check('journal rusak: replay tetap jalan', state.status === TASK_STATUS.RUNNING);
}

// ── [6] Ringkasan status untuk UI ───────────────────────────────────────────
{
  const j = createJournal({ dir: tmpDir, taskId: 'task-sum', goal: 'bikin report' });
  appendEntry(j, { type: 'status', status: TASK_STATUS.RUNNING });
  appendEntry(j, { type: 'action', action: 'write', target: 'r.md', verified: true });
  const summary = taskSummaryFromJournal(j.path);
  check('summary: punya taskId', summary.taskId === 'task-sum');
  check('summary: punya goal', summary.goal === 'bikin report');
  check('summary: punya status', summary.status === TASK_STATUS.RUNNING);
  check('summary: punya jumlah aksi', summary.actions === 1);
  check('summary: punya lastAction', summary.lastAction?.target === 'r.md');
}

// ── [7] Listing task ────────────────────────────────────────────────────────
{
  const list = listTaskFiles(tmpDir);
  check('list: menemukan file journal', Array.isArray(list) && list.length >= 4, `dapat ${list?.length}`);
  check('list: hanya file .jsonl', list.every(f => f.endsWith('.jsonl')));
  check('list: folder tidak ada -> array kosong', Array.isArray(listTaskFiles(path.join(tmpDir, 'ghost'))));
}

// ── [8] Robustness ──────────────────────────────────────────────────────────
{
  check('replay null tidak crash', replayJournal(null).status === undefined || typeof replayJournal(null) === 'object');
  check('readJournal file tidak ada -> array kosong', readJournal(path.join(tmpDir, 'nope.jsonl')).length === 0);
  check('summary file tidak ada -> null atau object aman',
    taskSummaryFromJournal(path.join(tmpDir, 'nope.jsonl')) === null);
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
console.log(`\n=== HASIL TASK-JOURNAL: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
