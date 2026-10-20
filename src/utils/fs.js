// lib/utils/fs.js - File system utilities

import fs from 'fs';
import path from 'path';

const ALLOW_ROOT = path.resolve(process.cwd());

const BLOCKED_NAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  '.ssh', '.gnupg', '.aws', '.npmrc', '.pypirc'
]);

const BLOCKED_SEGMENTS = ['.git'];

/**
 * Cek apakah target aman untuk diakses.
 * Path harus resolve ke dalam ALLOW_ROOT, tidak boleh symlink keluar,
 * dan tidak mengandung segment/file yang diblokir.
 * @param {string} target
 * @returns {boolean}
 */
export function isSafePath(target) {
  if (!target) return false;

  let resolved;
  try {
    resolved = path.resolve(target);
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
  if (!target || !fs.existsSync(target)) return '(file tidak ditemukan)';

  if (!isSafePath(target)) {
    return '(ACCESS DENIED: path diblokir karena keamanan)';
  }

  return fs.readFileSync(target, 'utf8');
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

  if (!target || !fs.existsSync(target)) {
    return { ok: false, content: '(file tidak ditemukan)', totalLines: 0, start: 0, end: 0, error: 'not_found' };
  }
  if (!isSafePath(target)) {
    return { ok: false, content: '(ACCESS DENIED: path diblokir karena keamanan)', totalLines: 0, start: 0, end: 0, error: 'blocked' };
  }
  if (fs.statSync(target).isDirectory()) {
    return { ok: false, content: `(ini direktori, bukan file — pakai list_dir)`, totalLines: 0, start: 0, end: 0, error: 'is_dir' };
  }

  let all;
  try {
    all = fs.readFileSync(target, 'utf8').split('\n');
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
  if (!fs.existsSync(dir)) return `(direktori '${dir}' tidak ditemukan)`;

  if (!isSafePath(dir)) {
    return '(ACCESS DENIED: path diblokir karena keamanan)';
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
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
  const pathMd = './AGENT.md';
  if (!fs.existsSync(pathMd)) return null;
  return fs.readFileSync(pathMd, 'utf8');
}