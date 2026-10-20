// src/modes.js — Mode approval (SAFE / WELL-WELL / YOLO)
//
// Tujuan: satu tempat definisi aturan approval, dipakai BERSAMA oleh REPL
// (src/repl.js) dan bot Telegram (src/telegram-bot.js). Jangan duplikat
// logika ini di dua tempat — itu penyebab perilaku REPL vs Telegram beda.
//
// Aturan dasar yang TIDAK BOLEH dilanggar oleh mode apapun:
//   - Aksi destruktif (delete/rename/remove, rm/sudo/dd/kill, dst) SELALU
//     minta approval di mode SAFE dan WELL-WELL.
//   - Hanya YOLO yang boleh melewatinya, itu pun dengan banner peringatan
//     eksplisit + harus dipilih manual oleh user (gak bisa jadi default).
//
// Written by K-sRouter

/** Nama mode yang valid. */
export const MODES = {
  SAFE: 'safe',
  WELLWELL: 'wellwell',
  YOLO: 'yolo',
};

/**
 * Aksi yang dianggap DESTRUKTIF — gak boleh auto-approve di mode selain YOLO.
 * Dipakai buat action type (bukan command shell, lihat ALWAYS_ASK_PATTERNS
 * di approval.js buat pola command).
 */
export const DESTRUCTIVE_ACTIONS = new Set(['delete', 'rename', 'move', 'remove']);

/** Alias biar user bisa ngetik variasi yang wajar. */
const ALIASES = {
  'safe': MODES.SAFE,
  'normal': MODES.SAFE,
  'default': MODES.SAFE,
  'wellwell': MODES.WELLWELL,
  'well-well': MODES.WELLWELL,
  'well_well': MODES.WELLWELL,
  'ww': MODES.WELLWELL,
  'yolo': MODES.YOLO,
  'terabas': MODES.YOLO,
};

/**
 * Normalisasi input user jadi nama mode. Balikin null kalau gak dikenal.
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeMode(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  return ALIASES[key] || null;
}

/** Deskripsi singkat tiap mode — buat `/mode` tanpa argumen. */
export const MODE_DESCRIPTIONS = {
  [MODES.SAFE]: 'Semua aksi (edit, bash, dll) minta approval satu-satu. Ini default.',
  [MODES.WELLWELL]: 'Edit & bash biasa auto-approve. Destruktif (delete/rename/remove, rm/sudo/dd/kill) TETAP ditanya.',
  [MODES.YOLO]: 'Terabas — semua auto-approve, TERMASUK yang destruktif. Hati-hati.',
};

/**
 * Tentukan hasil approval berdasarkan mode.
 *
 * @param {string} mode - salah satu MODES.*
 * @param {object} opts
 * @param {string} opts.action - label aksi ('edit' | 'bash' | 'delete' | ...)
 * @param {boolean} [opts.isDestructive] - aksi/command destruktif?
 * @returns {{ auto: boolean, approved: boolean, reason: string }}
 *          auto=false artinya caller HARUS nanya ke user kayak biasa.
 */
export function decide(mode, { action, isDestructive = false } = {}) {
  const current = normalizeMode(mode) || MODES.SAFE;

  if (current === MODES.YOLO) {
    return { auto: true, approved: true, reason: 'yolo' };
  }

  if (current === MODES.WELLWELL) {
    if (isDestructive) {
      return { auto: false, approved: false, reason: 'wellwell-destructive-still-asks' };
    }
    return { auto: true, approved: true, reason: 'wellwell' };
  }

  // SAFE — selalu nanya.
  return { auto: false, approved: false, reason: 'safe' };
}
