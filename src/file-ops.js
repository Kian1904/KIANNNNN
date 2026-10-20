// src/file-ops.js — Operasi file destruktif (delete / rename / move).
//
// Kenapa dipisah dari run-task.js: handler-nya panjang, dan yang paling
// penting — SEMUA operasi destruktif harus lewat SATU pintu, biar gak ada
// jalur yang kelewat. Pola yang sama dipakai modes.js (gate) dan
// approval.js (deteksi bahaya).
//
// Prinsip yang dipegang di sini:
//   1. Snapshot WAJIB sebelum hapus. Gagal snapshot = operasi DIBATALKAN.
//      Tanpa isi file di DB, /rollback cuma bisa bilang "file-nya udah ilang".
//   2. Direktori gak kosong DITOLAK. `rm -rf` gak akan pernah dilakukan
//      diam-diam dari sini — user harus eksplisit pakai bash + gate bahaya.
//   3. Path dicek isSafePath() DUA KALI (sebelum approval, sebelum eksekusi).
//      File bisa berubah antara "setuju" dan "jalan".
//
// Written by K-sRouter

import fs from 'fs';
import path from 'path';
import { isSafePath } from './utils/fs.js';

/**
 * Ringkas info target SEBELUM dihapus — biar user tau apa yang dia setujui.
 * @param {string} target
 * @returns {{ok:boolean, kind?:string, size?:number, lines?:number, preview?:string, error?:string, content?:string}}
 */
export function inspectTarget(target) {
  if (!isSafePath(target)) return { ok: false, error: 'blocked' };
  if (!fs.existsSync(target)) return { ok: false, error: 'not_found' };

  let st;
  try {
    st = fs.statSync(target);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (st.isDirectory()) {
    let entries;
    try {
      entries = fs.readdirSync(target);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    return {
      ok: true,
      kind: entries.length === 0 ? 'dir_empty' : 'dir_nonempty',
      entries: entries.length,
      sample: entries.slice(0, 5),
      size: 0,
    };
  }

  let content = '';
  try {
    content = fs.readFileSync(target, 'utf8');
  } catch {
    // Binary / gak bisa dibaca sbg teks. Bukan alasan buat batalin, tapi
    // preview gak tersedia — user harus dikasih tau.
    return { ok: true, kind: 'file_binary', size: st.size, content: null };
  }

  const lines = content.split('\n');
  return {
    ok: true,
    kind: 'file',
    size: st.size,
    lines: lines.length,
    preview: lines.slice(0, 8).join('\n'),
    more: Math.max(0, lines.length - 8),
    content,
  };
}

/**
 * Format ringkasan target buat ditampilin ke user sebelum approval.
 * @param {string} target
 * @param {ReturnType<typeof inspectTarget>} info
 * @returns {string}
 */
export function describeTarget(target, info) {
  if (!info.ok) {
    if (info.error === 'blocked') return `Path DIBLOKIR karena keamanan: ${target}`;
    if (info.error === 'not_found') return `File tidak ada: ${target}`;
    return `Gagal baca info ${target}: ${info.error}`;
  }
  if (info.kind === 'dir_empty') return `Direktori KOSONG: ${target}`;
  if (info.kind === 'dir_nonempty') {
    return `Direktori TIDAK KOSONG: ${target} (${info.entries} isi: ${info.sample.join(', ')}${info.entries > 5 ? ', ...' : ''})`;
  }
  if (info.kind === 'file_binary') return `File binary: ${target} (${info.size} byte, isi gak bisa ditampilin)`;
  return `File: ${target} (${info.size} byte, ${info.lines} baris)`;
}

/**
 * Alasan target GAK BOLEH dihapus, atau null kalau boleh.
 * Dipakai buat nolak SEBELUM minta approval — jangan bikin user
 * approve sesuatu yang bakal ditolak sistem.
 * @param {string} target
 * @param {ReturnType<typeof inspectTarget>} info
 * @returns {string|null}
 */
export function rejectReason(target, info) {
  if (!info.ok) {
    if (info.error === 'blocked') return 'path diblokir karena keamanan';
    if (info.error === 'not_found') return 'file tidak ada';
    return `gagal baca info: ${info.error}`;
  }
  if (info.kind === 'dir_nonempty') {
    return 'direktori tidak kosong — pakai bash dengan approval kalau memang mau dihapus rekursif';
  }
  return null;
}

/**
 * Jalanin operasi file destruktif. Pemanggil WAJIB sudah:
 *   - minta approval,
 *   - simpan snapshot (buat delete),
 *   - pastikan rejectReason() null.
 * Fungsi ini cuma eksekusi + bungkus errornya biar gak nge-crash task.
 *
 * @param {'delete'|'rename'|'move'} op
 * @param {string} target
 * @param {string} [dest] tujuan buat rename/move
 * @returns {{ok:boolean, error?:string}}
 */
export function applyFileOp(op, target, dest) {
  // Cek ulang — file bisa berubah antara approval dan eksekusi.
  if (!isSafePath(target)) return { ok: false, error: 'path target diblokir karena keamanan' };
  if (!fs.existsSync(target)) return { ok: false, error: 'target sudah tidak ada' };

  if (op === 'delete') {
    try {
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        // readdirSync kosong = aman. Gak kosong = tolak, titik.
        if (fs.readdirSync(target).length > 0) {
          return { ok: false, error: 'direktori tidak kosong — ditolak' };
        }
        fs.rmdirSync(target);
      } else {
        fs.unlinkSync(target);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  if (op === 'rename' || op === 'move') {
    if (!dest) return { ok: false, error: 'destinasi kosong' };
    if (!isSafePath(dest)) return { ok: false, error: 'path tujuan diblokir karena keamanan' };
    if (fs.existsSync(dest)) return { ok: false, error: `tujuan sudah ada: ${dest}` };

    try {
      const parent = path.dirname(dest);
      if (parent && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      // rename() di Node bisa mindahin antar direktori yang sama-sama di
      // filesystem yang sama. Beda device -> EXDEV, jadi fallback ke
      // copy + unlink biar gak gagal di Termux (home vs /storage).
      try {
        fs.renameSync(target, dest);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fs.cpSync(target, dest, { recursive: true });
        fs.rmSync(target, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: `operasi tidak dikenal: ${op}` };
}
