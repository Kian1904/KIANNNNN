// src/core/go-bridge.js — koneksi persistent ke binary Go (core-go/bin/kian-fs).
//
// Kenapa persistent: spawn proses per-request makan ~22ms di Termux — lebih
// mahal dari kerjaan itu sendiri. Dengan satu proses yang hidup dan bicara
// JSON-line, overhead-nya hilang (diff 2500 baris: 45ms → 7.4ms).
//
// Protokol: satu request JSON per baris di stdin, satu response JSON per baris
// di stdout. Request dikirim berurutan; response dipasangkan FIFO.
//
// Kalau binary tidak ada / mati, semua pemanggil fallback ke implementasi JS.

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_BIN = path.resolve(__dirname, '..', '..', 'core-go', 'bin', 'kian-fs');

let child = null;
let buf = '';
let pending = [];
let available = null; // null = belum dicek
let disabled = false; // true kalau pernah gagal fatal → jangan coba lagi

function binExists() {
  try {
    fs.accessSync(GO_BIN, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Ref/unref proses + stream-nya. Dipakai buat kontrol event loop Node. */
function setRef(on) {
  if (!child) return;
  const fn = on ? 'ref' : 'unref';
  try { child[fn](); } catch { /* ignore */ }
  for (const s of [child.stdin, child.stdout, child.stderr]) {
    if (s && typeof s[fn] === 'function') {
      try { s[fn](); } catch { /* ignore */ }
    }
  }
}

function ensureChild() {
  if (disabled) return null;
  if (child && !child.killed) return child;
  if (!binExists()) {
    available = false;
    return null;
  }

  child = spawn(GO_BIN, [], {
    env: { ...process.env, KIAN_WORKSPACE: process.env.KIAN_WORKSPACE || process.cwd() },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Ref/unref dinamis: saat ada request pending, proses HARUS menahan event loop
  // (biar Node tidak exit sebelum promise selesai). Saat idle, unref supaya
  // `node` bisa keluar bersih tanpa menggantung.
  setRef(false);

  child.stdout.on('data', (d) => {
    buf += d;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const resolve = pending.shift();
      if (!resolve) continue;
      if (pending.length === 0) setRef(false); // idle lagi → biarkan Node exit
      try {
        const parsed = JSON.parse(line);
        resolve(parsed.ok ? { ok: true, result: parsed.result, found: parsed.found } : { ok: false, error: parsed.error });
      } catch (e) {
        resolve({ ok: false, error: `JSON invalid: ${e.message}` });
      }
    }
  });

  child.on('error', () => {
    disabled = true;
    available = false;
    const p = pending;
    pending = [];
    for (const r of p) r({ ok: false, error: 'go bridge: spawn error' });
  });

  child.on('close', () => {
    child = null;
    const p = pending;
    pending = [];
    for (const r of p) r({ ok: false, error: 'go bridge: proses mati' });
  });

  available = true;
  return child;
}

/**
 * Kirim satu request ke Go. Return { ok, result } — tidak pernah throw.
 * @param {object} req
 * @returns {Promise<{ok: boolean, result?: any, error?: string}>}
 */
export function callGo(req) {
  const c = ensureChild();
  if (!c) return Promise.resolve({ ok: false, error: 'go bridge tidak tersedia' });
  return new Promise((resolve) => {
    pending.push(resolve);
    setRef(true); // tahan event loop selama ada request
    try {
      c.stdin.write(JSON.stringify(req) + '\n');
    } catch (e) {
      pending.pop();
      if (pending.length === 0) setRef(false);
      resolve({ ok: false, error: `write gagal: ${e.message}` });
    }
  });
}

/** Apakah bridge Go tersedia (binary ada & belum di-disable). */
export function goAvailable() {
  if (disabled) return false;
  if (available === null) ensureChild();
  return available === true;
}

/** Tutup proses Go (buat shutdown bersih / test). */
export function closeGo() {
  if (child) {
    try { child.stdin.end(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    child = null;
  }
  pending = [];
  buf = '';
}

/** Info diagnosa. */
export function goBridgeStatus() {
  return { available: goAvailable(), bin: GO_BIN, pid: child ? child.pid : null };
}
