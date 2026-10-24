// src/file-ops.js — Operasi file aman/destruktif lewat satu pintu.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { isSafePath } from './utils/fs.js';

export function inspectTarget(target) {
  if (!isSafePath(target)) return { ok: false, error: 'blocked' };
  if (!fs.existsSync(target)) return { ok: false, error: 'not_found' };
  let st;
  try { st = fs.statSync(target); } catch (err) { return { ok: false, error: err.message }; }
  if (st.isDirectory()) {
    let entries;
    try { entries = fs.readdirSync(target); } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true, kind: entries.length === 0 ? 'dir_empty' : 'dir_nonempty', entries: entries.length, sample: entries.slice(0, 5), size: 0 };
  }
  let content;
  try { content = fs.readFileSync(target, 'utf8'); } catch { return { ok: true, kind: 'file_binary', size: st.size, content: null }; }
  const lines = content.split('\n');
  return { ok: true, kind: 'file', size: st.size, lines: lines.length, preview: lines.slice(0, 8).join('\n'), more: Math.max(0, lines.length - 8), content };
}

export function describeTarget(target, info) {
  if (!info.ok) {
    if (info.error === 'blocked') return `Path DIBLOKIR karena keumanan: ${target}`;
    if (info.error === 'not_found') return `File tidak ada: ${target}`;
    return `Gagal baca info ${target}: ${info.error}`;
  }
  if (info.kind === 'dir_empty') return `Direktori KOSONG: ${target}`;
  if (info.kind === 'dir_nonempty') return `Direktori TIDAK KOSONG: ${target} (${info.entries} isi: ${info.sample.join(', ')}${info.entries > 5 ? ', ...' : ''})`;
  if (info.kind === 'file_binary') return `File binary: ${target} (${info.size} byte, isi gak bisa ditampilin)`;
  return `File: ${target} (${info.size} byte, ${info.lines} baris)`;
}

export function rejectReason(target, info) {
  if (!info.ok) {
    if (info.error === 'blocked') return 'path diblokir karena keamanan';
    if (info.error === 'not_found') return 'file tidak ada';
    return `gagal baca info: ${info.error}`;
  }
  if (info.kind === 'dir_nonempty') return 'direktori tidak kosong — pakai bash dengan approval kalau memang mau dihapus rekursif';
  return null;
}

export function rejectWriteReason(target, op) {
  if (!['write', 'append', 'mkdir'].includes(op)) return `operasi tidak dikenal: ${op}`;
  if (!isSafePath(target)) return 'path diblokir karena keamanan';
  if (op === 'write' && fs.existsSync(target)) return 'target sudah ada — write tidak boleh overwrite';
  if (op === 'mkdir' && fs.existsSync(target)) return 'direktori sudah ada';
  return null;
}

export function applySafeFileOp(op, target, content = '') {
  const rejected = rejectWriteReason(target, op);
  if (rejected) return { ok: false, error: rejected };
  try {
    const parent = path.dirname(target);
    if (parent && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    if (op === 'write') fs.writeFileSync(target, String(content), 'utf8');
    else if (op === 'append') fs.appendFileSync(target, String(content), 'utf8');
    else if (op === 'mkdir') fs.mkdirSync(target, { recursive: false });
    else return { ok: false, error: `operasi tidak dikenal: ${op}` };
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

export function applyFileOp(op, target, dest) {
  if (!isSafePath(target)) return { ok: false, error: 'path target diblokir karena keumanan' };
  if (!fs.existsSync(target)) return { ok: false, error: 'target sudah tidak ada' };
  if (op === 'delete') {
    try {
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        if (fs.readdirSync(target).length > 0) return { ok: false, error: 'direktori tidak kosong — ditolak' };
        fs.rmdirSync(target);
      } else fs.unlinkSync(target);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  if (op === 'rename' || op === 'move') {
    if (!dest) return { ok: false, error: 'destinasi kosong' };
    if (!isSafePath(dest)) return { ok: false, error: 'path tujuan diblokir karena keumanan' };
    if (fs.existsSync(dest)) return { ok: false, error: `tujuan sudah ada: ${dest}` };
    try {
      const parent = path.dirname(dest);
      if (parent && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      try { fs.renameSync(target, dest); } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fs.cpSync(target, dest, { recursive: true });
        fs.rmSync(target, { recursive: true, force: true });
      }
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  }
  return { ok: false, error: `operasi tidak dikenal: ${op}` };
}

// M44: auto-lint gate — setelah write/edit/append file JS. cek syntax.
// Kalau error, rollback ke konten sebelumnya dan kembalikkan pesan error.
export function lintAfterWrite(target, previousContent) {
  const ext = target.split('.').pop().toLowerCase();
  if (!['js', 'mjs', 'cjs'].includes(ext)) return { ok: true };
  try {
    execFileSync(process.execPath, ['--check', target], { timeout: 10000, stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    const raw = err.stderr ? String(err.stderr) : 'syntax error';
    const firstLine = raw.split(String.fromCharCode(10))[0];
    if (previousContent !== null && previousContent !== undefined) {
      try { fs.writeFileSync(target, previousContent, 'utf8'); } catch (e) { /* ignore */ }
      return { ok: false, error: 'LINT_FAIL: ' + firstLine + ' — file di-rollback ke versi sebelumnya.', rolledBack: true };
    }
    return { ok: false, error: 'LINT_FAIL: ' + firstLine, rolledBack: false };
  }
}
