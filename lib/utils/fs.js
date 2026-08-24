// lib/utils/fs.js - File system utilities

import fs from 'fs';
import path from 'path';

// 🚨 Daftar file & folder yang TIDAK BOLEH diakses AI
const BLOCKED_TARGETS = ['.env', '.env.local', 'id_rsa', '.git'];

/**
 * Cek apakah target aman untuk diakses
 * @param {string} target 
 * @returns {boolean}
 */
function isSafePath(target) {
  if (!target) return false;
  const normalized = path.normalize(target).toLowerCase();
  return !BLOCKED_TARGETS.some(blocked => normalized.includes(blocked));
}

/**
 * Baca file dengan aman, return placeholder kalau tidak ada / dilarang
 * @param {string|null} target
 * @returns {string}
 */
export function readFileSafe(target) {
  if (!target || !fs.existsSync(target)) return '(file lo mana oon? gak ketemu jirr)';
  
  // 🛡️ Proteksi file sensitif
  if (!isSafePath(target)) {
    return '(ACCESS DENIED: Wah mau nyolong .env / file rahasia ya lo?! Bahaya jir!)';
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
  if (!fs.existsSync(dir)) return `(direktori '${dir}' gak ada bro)`;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.length === 0) return '(kosong)';

    // 🛡️ Filter biar file sensitif kayak .env gak muncul di list
    return entries
      .filter(e => isSafePath(e.name))
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
