// lib/utils/fs.js - File system utilities
//
// Sejak M48: operasi inti didelegasikan ke binary Go (`core-go/cmd/kian-fs`)
// lewat protokol JSON-line di stdio. Kalau binary tidak ada / gagal start,
// otomatis fallback ke implementasi JS di bawah — jadi CLI tetap jalan tanpa
// Go terinstall (mis. user yang cuma `npm i -g`).

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getWorkspaceRoot, resolveWorkspacePath } from '../core/workspace.js';

const getAllowRoot = () => getWorkspaceRoot();

const BLOCKED_NAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  '.ssh', '.gnupg', '.aws', '.npmrc', '.pypirc'
]);

const BLOCKED_SEGMENTS = ['.git'];

// ── Bridge Go ────────────────────────────────────────────────────────────────
// Binary dicari relatif ke file ini: <repo>/core-go/bin/kian-fs
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_BIN = path.resolve(__dirname, '..', '..', 'core-go', 'bin', 'kian-fs');

let goAvailable = null; // null = belum dicek, true/false = hasil cek

function goReady() {
  if (goAvailable !== null) return goAvailable;
  try {
    fs.accessSync(GO_BIN, fs.constants.X_OK);
    goAvailable = true;
  } catch {
    goAvailable = false;
  }
  return goAvailable;
}

/**
 * Kirim satu request ke binary Go, balikin hasilnya.
 * @param {object} req
 * @returns {Promise<any>}
 */
function callGo(req) {
  return new Promise((resolve, reject) => {
    const child = spawn(GO_BIN, [], {
      env: { ...process.env, KIAN_WORKSPACE: getAllowRoot() },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `kian-fs exit ${code}`));
      const line = out.split('\n').find((l) => l.trim());
      if (!line) return reject(new Error('kian-fs: output kosong'));
      try {
        const parsed = JSON.parse(line);
        if (!parsed.ok) return reject(new Error(parsed.error || 'kian-fs error'));
        resolve(parsed.result);
      } catch (e) {
        reject(new Error(`kian-fs: JSON invalid — ${e.message}`));
      }
    });
    child.stdin.end(JSON.stringify(req) + '\n');
  });
}

// ── Implementasi JS (fallback) ───────────────────────────────────────────────

/**
 * Cek apakah target aman untuk diakses.
 * Path harus resolve ke dalam ALLOW_ROOT, tidak boleh symlink keluar,
 * dan tidak mengandung segment/file yang diblokir.
 * @param {string} target
 * @returns {boolean}
 */
export function isSafePath(target) {
  if (!target) return false;

  const ALLOW_ROOT = getAllowRoot();
  let resolved;
  try {
    resolved = resolveWorkspacePath(target);
  } catch {
    return false;
  }

  if (!resolved.startsWith(ALLOW_ROOT + path.sep) && resolved !== ALLOW_ROOT) {
    return false;
  }

  const segments = resolved.slice(ALLOW_ROOT.length).split(path.sep).filter(Boolean);
  for (const seg of segments) {
    if (BLOCKED_NAMES.has(seg.toLowerCase())) return false;
    if (BLOCKED_SEGMENTS.includes(seg)) return false;
  }

  try {
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(ALLOW_ROOT + path.sep) && real !== ALLOW_ROOT) {
      return false;
    }
  } catch {
    // File belum ada — izinkan (buat write), tapi tetap cek nama
  }

  return true;
}

/**
 * Baca file dengan aman, return placeholder kalau tidak ada / dilarang
 * @param {string|null} target
 * @returns {string}
 */
export function readFileSafe(target) {
  const resolved = resolveWorkspacePath(target);
  if (!target || !fs.existsSync(resolved)) return '(file tidak ditemukan)';

  if (!isSafePath(target)) {
    return '(ACCESS DENIED: path diblokir karena keamanan)';
  }

  return fs.readFileSync(resolved, 'utf8');
}

/**
 * Baca file SEGIAN doang, dengan nomor baris.
 *
 * Kenapa: readFileSafe ngebalikin seluruh isi, dan pemanggilnya motong ke 2000
 * karakter. Buat file besar itu artinya agent CUMA liat awalannya — bug di
 * baris 500 gak akan pernah kelihatan. Ini ngasih agent cara "geser jendela".
 *
 * @param {string|null} target
 * @param {number} offset  baris awal (1-indexed, default 1)
 * @param {number} limit   jumlah baris yang dibaca (default 400)
 * @returns {{ ok: boolean, content: string, totalLines: number, start: number, end: number, error?: string }}
 */
export function readFileRange(target, offset = 1, limit = 400) {
  const off = Math.max(1, Number(offset) || 1);
  const lim = Math.max(1, Math.min(Number(limit) || 400, 5000));
  const resolved = target ? resolveWorkspacePath(target) : null;

  if (!target || !fs.existsSync(resolved)) {
    return { ok: false, content: '(file tidak ditemukan)', totalLines: 0, start: 0, end: 0, error: 'not_found' };
  }
  if (!isSafePath(target)) {
    return { ok: false, content: '(ACCESS DENIED: path diblokir karena keamanan)', totalLines: 0, start: 0, end: 0, error: 'blocked' };
  }
  if (fs.statSync(resolved).isDirectory()) {
    return { ok: false, content: `(ini direktori, bukan file — pakai list_dir)`, totalLines: 0, start: 0, end: 0, error: 'is_dir' };
  }

  let all;
  try {
    all = fs.readFileSync(resolved, 'utf8').split('\n');
  } catch (err) {
    return { ok: false, content: `(gagal baca: ${err.message})`, totalLines: 0, start: 0, end: 0, error: 'read_failed' };
  }

  const totalLines = all.length;
  const start = Math.min(off, totalLines || 1);
  const end = Math.min(start + lim - 1, totalLines);
  const slice = all.slice(start - 1, end);

  const pad = String(end).length;
  let content = slice
    .map((line, i) => `${String(start + i).padStart(pad, ' ')}|${line}`)
    .join('\n');

  if (end < totalLines) {
    content += `\n\n[...ADA ${totalLines - end} BARIS LAGI. Lanjut: offset=${end + 1} limit=${lim}]`;
  }

  return { ok: true, content, totalLines, start, end };
}

/**
 * List isi direktori (dengan menyembunyikan file sensitif)
 * @param {string|null} target
 * @returns {string}
 */
export function listDirSafe(target) {
  const dir = (target || '.').trim();
  const resolved = resolveWorkspacePath(dir);
  if (!fs.existsSync(resolved)) return `(direktori '${dir}' tidak ditemukan)`;

  if (!isSafePath(dir)) {
    return '(ACCESS DENIED: path diblokir karena keamanan)';
  }

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    if (entries.length === 0) return '(kosong)';

    return entries
      .filter(e => isSafePath(path.join(dir, e.name)))
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .join('\n');
  } catch (err) {
    return `(error baca direktori: ${err.message})`;
  }
}

/**
 * load AGENT.md dari root project.
 * @returns {string|null}
 */
export function loadAgentMd() {
  const pathMd = resolveWorkspacePath('AGENT.md');
  if (!fs.existsSync(pathMd)) return null;
  return fs.readFileSync(pathMd, 'utf8');
}

// ── Versi async (delegasi ke Go kalau tersedia) ──────────────────────────────

/**
 * Versi async dari readFileRange. Pakai Go kalau binary tersedia.
 * @param {string|null} target
 * @param {number} offset
 * @param {number} limit
 * @returns {Promise<object>}
 */
export async function readFileRangeAsync(target, offset = 1, limit = 400) {
  if (goReady()) {
    try {
      return await callGo({ op: 'readFileRange', target, offset, limit });
    } catch {
      // fallback ke JS
    }
  }
  return readFileRange(target, offset, limit);
}

/**
 * Versi async dari listDirSafe. Pakai Go kalau binary tersedia.
 * @param {string|null} target
 * @returns {Promise<string>}
 */
export async function listDirSafeAsync(target) {
  if (goReady()) {
    try {
      return await callGo({ op: 'listDirSafe', target });
    } catch {
      // fallback ke JS
    }
  }
  return listDirSafe(target);
}

/**
 * Versi async dari readFileSafe. Pakai Go kalau binary tersedia.
 * @param {string|null} target
 * @returns {Promise<string>}
 */
export async function readFileSafeAsync(target) {
  if (goReady()) {
    try {
      return await callGo({ op: 'readFileSafe', target });
    } catch {
      // fallback ke JS
    }
  }
  return readFileSafe(target);
}

/** Status bridge Go — buat diagnosa / test. */
export function goBridgeStatus() {
  return { available: goReady(), bin: GO_BIN };
}
