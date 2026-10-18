// src/approval.js — Aturan approval/destruktif yang DIPAKAI BERSAMA
// oleh REPL terminal dan bot Telegram, biar perilakunya identik.
//
// Dipindah dari repl.js (M17) supaya jalur Telegram gak duplikat regex
// dan gak beda perilaku sama sekali kalau aturannya nanti berubah.
//
// Written by K-sRouter

export const ALWAYS_ASK_PATTERNS = [
  /\brm\b/, /\bsudo\b/, /\bchmod\b/, /\bdd\b/,
  /\bnpm\s+uninstall\b/, /\bpkg\s+uninstall\b/, /\bkill\b/
];

/**
 * True kalau command shell ini WAJIB ditanya tiap kali (gak boleh
 * auto-approved lewat "allow for session").
 * @param {string} command
 * @returns {boolean}
 */
export function isDangerous(command) {
  return ALWAYS_ASK_PATTERNS.some(p => p.test(command));
}
