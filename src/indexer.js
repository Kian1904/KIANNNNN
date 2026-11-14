// src/indexer.js — index simbol codebase (fungsi, class, export, import).
//
// Kenapa ini ada: agent perlu tau "fungsi X ada di file mana" tanpa baca
// seluruh codebase. Indexer scan semua file, ekstrak simbol, dan simpan
// hasilnya. Ini operasi CPU-bound berat (regex + loop di ribuan baris).
//
// Sejak M52: ada versi async (buildIndexAsync) yang delegasi ke binary Go.
// Ini kandidat yang BENERAN cocok buat Go — kerjaannya jauh lebih besar dari
// biaya bridge (beda dari regex/Levenshtein yang selesai <1ms di JS).
//
// Written by K'

import fs from 'fs';
import path from 'path';
import { callGo, goAvailable, goBridgeStatus as _goStatus } from './core/go-bridge.js';

// Pola ekstraksi simbol (JS/TS).
const SYMBOL_PATTERNS = [
  { kind: 'function', re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm },
  { kind: 'class', re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
  { kind: 'const_fn', re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm },
  { kind: 'export', re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm },
  { kind: 'import', re: /^\s*import\s+.*?from\s+['"]([^'"]+)['"]/gm },
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.qwen', 'dist', 'build', 'coverage']);

/**
 * Kumpulkan semua file yang bisa di-index (rekursif).
 * @param {string} root
 * @param {string[]} exts
 * @returns {string[]}
 */
export function collectFiles(root, exts = ['.js', '.mjs', '.ts', '.tsx', '.jsx']) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Ekstrak simbol dari satu konten file.
 * @param {string} content
 * @param {string} file
 * @returns {Array<{kind: string, name: string, file: string, line: number}>}
 */
export function extractSymbols(content, file) {
  const symbols = [];
  const lines = content.split('\n');
  for (const { kind, re } of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      // hitung nomor baris dari index match
      let line = 1;
      for (let i = 0; i < m.index && i < content.length; i++) {
        if (content[i] === '\n') line++;
      }
      symbols.push({ kind, name: m[1], file, line });
      if (m.index === re.lastIndex) re.lastIndex++; // hindari infinite loop
    }
  }
  return symbols;
}

/**
 * Bangun index dari daftar file.
 * @param {string[]} files
 * @returns {{symbols: Array, files: number, totalLines: number}}
 */
export function buildIndex(files) {
  const symbols = [];
  let totalLines = 0;
  for (const f of files) {
    let content;
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    totalLines += content.split('\n').length;
    symbols.push(...extractSymbols(content, f));
  }
  return { symbols, files: files.length, totalLines };
}

/**
 * Cari simbol berdasarkan nama (substring, case-insensitive).
 * @param {Array} symbols
 * @param {string} query
 * @returns {Array}
 */
export function findSymbol(symbols, query) {
  const q = String(query).toLowerCase();
  return symbols.filter((s) => s.name.toLowerCase().includes(q));
}

// ── Versi async (delegasi ke Go kalau tersedia) ──────────────────────────────

/**
 * Versi async dari buildIndex. Pakai Go kalau bridge tersedia.
 * @param {string[]} files
 * @returns {Promise<{symbols: Array, files: number, totalLines: number}>}
 */
export async function buildIndexAsync(files) {
  if (goAvailable()) {
    const res = await callGo({ op: 'buildIndex', files });
    if (res.ok) return res.result;
  }
  return buildIndex(files);
}

/** Status bridge Go — buat diagnosa / test. */
export function goBridgeStatus() {
  return _goStatus();
}
