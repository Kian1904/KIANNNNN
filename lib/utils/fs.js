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
function isSafePath(target) {
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

</content>