// M48: task journal — append-only, crash-safe, tanpa secret.
//
// Kenapa append-only JSONL, bukan SQLite untuk journal ini:
// - baris terakhir bisa terpotong saat proses dibunuh; reader cukup skip baris
//   rusak dan tetap dapat state valid dari baris sebelumnya;
// - tidak perlu lock, tidak ada migration;
// - gampang di-grep, gampang dihapus per task.
//
// Written by K'

import fs from 'fs';
import path from 'path';
import os from 'os';

export const TASK_STATUS = Object.freeze({
  QUEUED: 'queued',
  PLANNING: 'planning',
  AWAITING_APPROVAL: 'awaiting_approval',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  RETRYING: 'retrying',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  PAUSED: 'paused',
});

const TERMINAL = new Set([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]);

/** Transisi status yang sah. Terminal tidak pernah bisa dibangunkan. */
const TRANSITIONS = {
  [TASK_STATUS.QUEUED]: [TASK_STATUS.PLANNING, TASK_STATUS.RUNNING, TASK_STATUS.BLOCKED, TASK_STATUS.CANCELLED, TASK_STATUS.FAILED],
  [TASK_STATUS.PLANNING]: [TASK_STATUS.AWAITING_APPROVAL, TASK_STATUS.RUNNING, TASK_STATUS.BLOCKED, TASK_STATUS.CANCELLED, TASK_STATUS.FAILED],
  [TASK_STATUS.AWAITING_APPROVAL]: [TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED, TASK_STATUS.BLOCKED],
  [TASK_STATUS.RUNNING]: [TASK_STATUS.VERIFYING, TASK_STATUS.BLOCKED, TASK_STATUS.RETRYING, TASK_STATUS.PAUSED, TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED],
  [TASK_STATUS.BLOCKED]: [TASK_STATUS.RUNNING, TASK_STATUS.RETRYING, TASK_STATUS.PAUSED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED],
  [TASK_STATUS.RETRYING]: [TASK_STATUS.RUNNING, TASK_STATUS.BLOCKED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED],
  [TASK_STATUS.VERIFYING]: [TASK_STATUS.RUNNING, TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.BLOCKED, TASK_STATUS.CANCELLED],
  [TASK_STATUS.PAUSED]: [TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED, TASK_STATUS.FAILED],
  [TASK_STATUS.COMPLETED]: [],
  [TASK_STATUS.FAILED]: [],
  [TASK_STATUS.CANCELLED]: [],
};

export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}

export function canTransition(from, to) {
  if (!from || !to) return false;
  const allowed = TRANSITIONS[from];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(to);
}

// ── Redaksi secret ──────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  [/\b(sk|rk)-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\bgsk_[A-Za-z0-9]{16,}/g, '[REDACTED]'],
  [/\boc_sk_[A-Za-z0-9]{16,}/g, '[REDACTED]'],
  [/\bghp_[A-Za-z0-9]{16,}/g, '[REDACTED]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED]'],
  [/\b(Bearer)\s+[A-Za-z0-9._-]{16,}/g, '$1 [REDACTED]'],
  [/\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)\s*[=:]\s*["']?[^\s"',}]{8,}/gi, '$1=[REDACTED]'],
];

/**
 * Buang nilai secret dari teks/objek sebelum masuk journal.
 * Kunci (nama variabel) dipertahankan supaya jejak audit tetap berguna.
 */
export function redactSecrets(value) {
  if (typeof value === 'string') {
    let out = value;
    for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactSecrets(v);
    return out;
  }
  return value;
}

// ── Path & nama file ────────────────────────────────────────────────────────

export function defaultJournalDir() {
  return path.join(os.homedir(), '.kian_data', 'tasks');
}

function safeTaskId(taskId) {
  return String(taskId).replace(/[^A-Za-z0-9._-]/g, '_');
}

export function taskPath(dir, taskId) {
  return path.join(dir, `${safeTaskId(taskId)}.jsonl`);
}

function nowIso() {
  return new Date().toISOString();
}

// ── Journal writer ──────────────────────────────────────────────────────────

/**
 * Buat journal baru untuk satu task. Menulis entry header secara sinkron
 * supaya kalau proses mati tepat setelah ini, jejaknya tetap ada.
 */
export function createJournal({ dir = defaultJournalDir(), taskId, goal = '', status = TASK_STATUS.QUEUED, meta = {} } = {}) {
  if (!taskId) throw new Error('createJournal butuh taskId');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = taskPath(dir, taskId);

  const entry = {
    seq: 1,
    at: nowIso(),
    type: 'task_start',
    taskId,
    goal: redactSecrets(String(goal || '')),
    status,
    meta: redactSecrets(meta || {}),
  };
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  return { dir, taskId, path: filePath, entry, lastSeq: 1 };
}

/**
 * Tambah satu entry ke journal. Selalu di-redact. Mengembalikan entry final.
 * Kalau disk penuh / gagal tulis, JANGAN crash — journal tidak boleh mematikan
 * task yang sedang jalan.
 */
export function appendEntry(journal, entry = {}) {
  if (!journal || !journal.path) return null;
  const seq = (journal.lastSeq || 0) + 1;
  const final = redactSecrets({
    seq,
    at: nowIso(),
    ...entry,
  });
  try {
    fs.appendFileSync(journal.path, JSON.stringify(final) + '\n');
    journal.lastSeq = seq;
  } catch {
    // Gagal tulis journal bukan alasan mematikan task.
  }
  return final;
}

// ── Journal reader ──────────────────────────────────────────────────────────

/**
 * Baca semua entry valid. Baris rusak (mis. terpotong saat crash) di-skip,
 * bukan bikin seluruh journal gagal dibaca.
 */
export function readJournal(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
  } catch { return []; }

  let raw = '';
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return []; }

  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') entries.push(parsed);
    } catch {
      // Baris rusak: lanjut. Ini justru inti dari crash-safety.
    }
  }
  entries.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  return entries;
}

/**
 * Bangun ulang state task dari entry journal.
 * @param {Array} entries
 */
export function replayJournal(entries = []) {
  const state = {
    taskId: null,
    goal: '',
    status: undefined,
    actions: [],
    acceptance: {},
    notes: [],
    lastAction: null,
    verifiedCount: 0,
    unverifiedCount: 0,
    startedAt: null,
    updatedAt: null,
  };
  if (!Array.isArray(entries)) return state;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.at) state.updatedAt = entry.at;

    if (entry.type === 'task_start') {
      state.taskId = entry.taskId || null;
      state.goal = entry.goal || '';
      state.status = entry.status;
      state.startedAt = state.startedAt || entry.at || null;
      continue;
    }

    if (entry.type === 'status' && entry.status) {
      state.status = entry.status;
      continue;
    }

    if (entry.type === 'action') {
      const action = {
        action: entry.action,
        target: entry.target,
        command: entry.command,
        verified: entry.verified === true,
        error: entry.error,
        at: entry.at,
      };
      state.actions.push(action);
      state.lastAction = action;
      if (entry.verified === true) state.verifiedCount++;
      else state.unverifiedCount++;
      continue;
    }

    if (entry.type === 'acceptance' && entry.id) {
      state.acceptance[entry.id] = { status: entry.status, evidence: entry.evidence };
      continue;
    }

    if (entry.type === 'note') {
      state.notes.push({ text: entry.text, at: entry.at });
    }
  }

  return state;
}

/**
 * Ringkasan ringkas untuk UI/CLI/Telegram.
 * @returns {object|null}
 */
export function taskSummaryFromJournal(filePath) {
  const entries = readJournal(filePath);
  if (entries.length === 0) return null;
  const state = replayJournal(entries);
  return {
    taskId: state.taskId,
    goal: state.goal,
    status: state.status,
    actions: state.actions.length,
    lastAction: state.lastAction,
    verifiedCount: state.verifiedCount,
    unverifiedCount: state.unverifiedCount,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    terminal: isTerminalStatus(state.status),
  };
}

/** Daftar file journal di sebuah folder. */
export function listTaskFiles(dir = defaultJournalDir()) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f))
      .sort();
  } catch {
    return [];
  }
}
