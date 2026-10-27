// M54: worker lifecycle — lease, heartbeat, timeout, cancel, retry, conflict.
//
// Kenapa ini ada: worker squad selama ini jalan tanpa identitas lifecycle.
// Tidak ada cara tahu worker mana yang masih hidup, mana yang stuck, mana yang
// boleh retry, dan tidak ada deteksi dua worker mengerjakan task yang sama.
//
// Written by K'

export const WORKER_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
});

const TERMINAL = new Set([
  WORKER_STATUS.COMPLETED,
  WORKER_STATUS.FAILED,
  WORKER_STATUS.CANCELLED,
  WORKER_STATUS.TIMEOUT,
]);

const DEFAULT_TIMEOUT_MS = 120_000; // 2 menit default
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Buat worker baru.
 * @param {{id:string, role:string, taskId:string, timeoutMs?:number, maxAttempts?:number}} input
 * @returns {object} worker state
 */
export function createWorker(input = {}) {
  return {
    id: input.id || `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    role: input.role || 'generic',
    taskId: input.taskId || null,
    status: WORKER_STATUS.PENDING,
    attempts: 0,
    maxAttempts: Number.isInteger(input.maxAttempts) && input.maxAttempts > 0
      ? input.maxAttempts
      : DEFAULT_MAX_ATTEMPTS,
    timeoutMs: Number.isFinite(input.timeoutMs) ? input.timeoutMs : DEFAULT_TIMEOUT_MS,
    lastHeartbeat: Date.now(),
    leasedAt: null,
    releasedAt: null,
    result: null,
    cancelReason: null,
  };
}

/**
 * Update heartbeat timestamp.
 */
export function heartbeat(worker) {
  if (!worker) return;
  worker.lastHeartbeat = Date.now();
}

/**
 * Apakah worker masih hidup? (heartbeat dalam batas timeout)
 */
export function isAlive(worker) {
  if (!worker) return false;
  if (TERMINAL.has(worker.status)) return false;
  if (!worker.lastHeartbeat) return false;
  return Date.now() - worker.lastHeartbeat < (worker.timeoutMs || DEFAULT_TIMEOUT_MS);
}

/**
 * Apakah worker sudah timeout?
 */
export function isTimedOut(worker) {
  if (!worker) return false;
  if (!worker.timeoutMs) return false; // tanpa timeout = tidak pernah timeout
  return Date.now() - worker.lastHeartbeat > worker.timeoutMs;
}

/**
 * Ambil lease: worker mulai mengerjakan task.
 */
export function leaseTask(worker) {
  if (!worker) return null;
  worker.status = WORKER_STATUS.RUNNING;
  worker.leasedAt = Date.now();
  worker.attempts++;
  return worker;
}

/**
 * Lepaskan lease: worker selesai (sukses atau gagal).
 * @param {object} worker
 * @param {string} result - 'done' untuk sukses, error message untuk gagal
 */
export function releaseTask(worker, result = '') {
  if (!worker) return null;
  worker.releasedAt = Date.now();
  worker.result = result;
  if (result === 'done' || result === 'ok') {
    worker.status = WORKER_STATUS.COMPLETED;
  } else {
    worker.status = WORKER_STATUS.FAILED;
  }
  return worker;
}

/**
 * Batalkan worker.
 */
export function cancelWorker(worker, reason = '') {
  if (!worker) return null;
  worker.status = WORKER_STATUS.CANCELLED;
  worker.cancelReason = reason;
  worker.releasedAt = Date.now();
  return worker;
}

/**
 * Apakah worker boleh dicoba lagi?
 * Tidak boleh kalau: sudah terminal, sudah mencapai maxAttempts, atau dibatalkan.
 */
export function shouldRetry(worker) {
  if (!worker) return false;
  if (worker.status === WORKER_STATUS.CANCELLED) return false;
  if (worker.status === WORKER_STATUS.COMPLETED) return false;
  return worker.attempts < worker.maxAttempts;
}

/**
 * Deteksi apakah ada worker lain yang sedang mengerjakan task yang sama.
 * @param {object} worker - worker yang mau di-lease
 * @param {Array} registry - daftar semua worker
 * @returns {boolean} true = ada konflik
 */
export function detectConflict(worker, registry = []) {
  if (!worker || !worker.taskId) return false;
  return registry.some(w =>
    w && w.id !== worker.id
    && w.taskId === worker.taskId
    && w.status === WORKER_STATUS.RUNNING
  );
}

/**
 * Daftar semua worker, sorted by id.
 */
export function listWorkers(registry) {
  if (registry instanceof Map) {
    return [...registry.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  if (Array.isArray(registry)) {
    return [...registry].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return [];
}

/**
 * Ambil worker by ID.
 */
export function getWorker(id, registry) {
  if (registry instanceof Map) return registry.get(id) || null;
  if (Array.isArray(registry)) return registry.find(w => w && w.id === id) || null;
  return null;
}
