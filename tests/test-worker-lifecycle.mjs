// M54 RED: worker lifecycle — lease, heartbeat, timeout, cancel, retry, conflict.
import {
  WORKER_STATUS, createWorker, heartbeat, isAlive, isTimedOut,
  leaseTask, releaseTask, cancelWorker, shouldRetry, detectConflict,
  listWorkers, getWorker,
} from '../src/worker-lifecycle.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] createWorker ────────────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w1', role: 'coder', taskId: 't1' });
  check('create: punya id', w.id === 'w1');
  check('create: punya role', w.role === 'coder');
  check('create: punya taskId', w.taskId === 't1');
  check('create: status awal PENDING', w.status === WORKER_STATUS.PENDING);
  check('create: punya heartbeat awal', typeof w.lastHeartbeat === 'number');
  check('create: attempts 0', w.attempts === 0);
  check('create: maxAttempts default', typeof w.maxAttempts === 'number' && w.maxAttempts > 0);
}

// ── [2] heartbeat & isAlive ─────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w2', role: 'researcher', taskId: 't2' });
  check('alive: baru dibuat -> alive', isAlive(w) === true);
  const old = { ...w, timeoutMs: 30000, lastHeartbeat: Date.now() - 60000 };
  check('alive: heartbeat lama -> mati', isAlive(old) === false);
  heartbeat(w);
  check('heartbeat: update timestamp', w.lastHeartbeat > Date.now() - 1000);
}

// ── [3] isTimedOut ──────────────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w3', role: 'coder', taskId: 't3', timeoutMs: 5000 });
  check('timeout: belum timeout', isTimedOut(w) === false);
  const stale = { ...w, lastHeartbeat: Date.now() - 10000 };
  check('timeout: heartbeat lama -> timeout', isTimedOut(stale) === true);
  check('timeout: tanpa timeoutMs -> false', isTimedOut({ ...w, timeoutMs: null, lastHeartbeat: Date.now() - 999999 }) === false);
}

// ── [4] leaseTask ───────────────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w4', role: 'coder', taskId: 't4' });
  const leased = leaseTask(w);
  check('lease: status jadi RUNNING', leased.status === WORKER_STATUS.RUNNING);
  check('lease: taskId tetap', leased.taskId === 't4');
  check('lease: ada leasedAt', typeof leased.leasedAt === 'number');
}

// ── [5] releaseTask ─────────────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w5', role: 'coder', taskId: 't5' });
  leaseTask(w);
  const released = releaseTask(w, 'done');
  check('release: status jadi COMPLETED', released.status === WORKER_STATUS.COMPLETED);
  check('release: result tercatat', released.result === 'done');

  const w2 = createWorker({ id: 'w5b', role: 'coder', taskId: 't5b' });
  leaseTask(w2);
  const failed = releaseTask(w2, 'error: timeout');
  check('release: failure -> FAILED', failed.status === WORKER_STATUS.FAILED);
}

// ── [6] cancelWorker ────────────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w6', role: 'coder', taskId: 't6' });
  leaseTask(w);
  const cancelled = cancelWorker(w, 'user stop');
  check('cancel: status jadi CANCELLED', cancelled.status === WORKER_STATUS.CANCELLED);
  check('cancel: reason tercatat', cancelled.cancelReason === 'user stop');
}

// ── [7] shouldRetry ─────────────────────────────────────────────────────────
{
  const w = createWorker({ id: 'w7', role: 'coder', taskId: 't7', maxAttempts: 3 });
  check('retry: attempts 0 -> boleh', shouldRetry(w) === true);
  const w2 = { ...w, attempts: 1 };
  check('retry: attempts 1 -> boleh', shouldRetry(w2) === true);
  const w3 = { ...w, attempts: 3 };
  check('retry: attempts = max -> tidak', shouldRetry(w3) === false);
  const w4 = { ...w, status: WORKER_STATUS.CANCELLED, attempts: 1 };
  check('retry: cancelled -> tidak', shouldRetry(w4) === false);
  const w5 = { ...w, status: WORKER_STATUS.COMPLETED, attempts: 1 };
  check('retry: completed -> tidak', shouldRetry(w5) === false);
}

// ── [8] detectConflict ──────────────────────────────────────────────────────
{
  const w1 = createWorker({ id: 'w8a', role: 'coder', taskId: 't8' });
  const w2 = createWorker({ id: 'w8b', role: 'coder', taskId: 't8' });
  leaseTask(w1);
  const conflict = detectConflict(w2, [w1]);
  check('conflict: dua worker task sama -> conflict', conflict === true);

  const w3 = createWorker({ id: 'w8c', role: 'coder', taskId: 't9' });
  leaseTask(w3);
  const noConflict = detectConflict(w3, [w1]);
  check('conflict: task beda -> no conflict', noConflict === false);

  const w4 = createWorker({ id: 'w8d', role: 'coder', taskId: 't8' });
  const freeTask = detectConflict(w4, []);
  check('conflict: tanpa worker lain -> no conflict', freeTask === false);
}

// ── [9] listWorkers & getWorker ─────────────────────────────────────────────
{
  const registry = new Map();
  const w1 = createWorker({ id: 'w9a', role: 'coder', taskId: 'ta' });
  const w2 = createWorker({ id: 'w9b', role: 'reviewer', taskId: 'tb' });
  registry.set(w1.id, w1);
  registry.set(w2.id, w2);

  const list = listWorkers(registry);
  check('list: semua worker terdaftar', list.length === 2);
  check('list: sorted by id', list[0].id <= list[1].id);

  const found = getWorker('w9a', registry);
  check('get: worker ditemukan', found && found.id === 'w9a');
  check('get: id tidak dikenal -> null', getWorker('ghost', registry) === null);
}

// ── [10] WORKER_STATUS ──────────────────────────────────────────────────────
{
  check('status: PENDING ada', WORKER_STATUS.PENDING === 'pending');
  check('status: RUNNING ada', WORKER_STATUS.RUNNING === 'running');
  check('status: COMPLETED ada', WORKER_STATUS.COMPLETED === 'completed');
  check('status: FAILED ada', WORKER_STATUS.FAILED === 'failed');
  check('status: CANCELLED ada', WORKER_STATUS.CANCELLED === 'cancelled');
  check('status: TIMEOUT ada', WORKER_STATUS.TIMEOUT === 'timeout');
}

// ── [11] Robustness ─────────────────────────────────────────────────────────
{
  check('create: tanpa id tidak crash', typeof createWorker({}) === 'object');
  check('heartbeat: null tidak crash', (() => { try { heartbeat(null); return true; } catch { return false; } })());
  check('isAlive: null -> false', isAlive(null) === false);
  check('leaseTask: null -> null', leaseTask(null) === null);
  check('cancelWorker: null -> null', cancelWorker(null) === null);
}

console.log(`\n=== HASIL WORKER-LIFECYCLE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
