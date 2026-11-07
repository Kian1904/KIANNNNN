import fs from 'node:fs';
import path from 'node:path';
import { getLatestSnapshot, listSnapshots } from '../db.js';
import { readFileSafe } from '../utils/fs.js';
import { showDiff } from '../diff.js';
import { resolveWorkspacePath } from './workspace.js';

export async function handleRollback(filepath, { ask, print, printBlock, sep } = {}) {
  if (!filepath) {
    const snaps = listSnapshots();
    if (snaps.length === 0) print('rollback', 'Belum ada snapshot tersimpan.');
    else {
      print('rollback', 'File yang punya snapshot:');
      snaps.forEach(s => printBlock(`${s.filepath}  —  ${s.versions} versi, terakhir: ${s.last_snapshot}`, 6));
    }
    return;
  }
  const snap = getLatestSnapshot(filepath);
  if (!snap) { print('rollback', `Tidak ada snapshot untuk ${filepath}.`); return; }
  const current = readFileSafe(filepath);
  if (snap.is_new_file) {
    if (current === '(file tidak ditemukan)') { print('rollback', 'File sudah tidak ada — tidak ada yang perlu di-rollback.'); return; }
    print('diff', `${filepath}  (file BARU — rollback = hapus file)`);
    printBlock(showDiff(current, '')); sep();
    if ((await ask('  Hapus file ini untuk rollback? (y/n): ')).trim().toLowerCase() === 'y') {
      try { fs.unlinkSync(resolveWorkspacePath(filepath)); print('rollback', `${filepath} dihapus (kondisi sebelum file dibuat).`); }
      catch (err) { print('error', `Gagal menghapus file: ${err.message}`); }
    } else print('rollback', 'Dibatalkan.');
    return;
  }
  print('diff', `${filepath}  (current → snapshot ${snap.created_at})`);
  const currentMissing = current === '(file tidak ditemukan)';
  if (!currentMissing && !snap.content) { print('rollback', `Snapshot ${snap.created_at} kosong — tidak ada isi untuk dikembalikan.`); print('rollback', 'Rollback DIBATALKAN biar isi file sekarang gak ketimpa kosong.'); return; }
  printBlock(showDiff(currentMissing || current.startsWith('(ACCESS DENIED') ? '' : current, snap.content)); sep();
  const prompt = currentMissing ? '  File sudah tidak ada. Pulihkan dari snapshot? (y/n): ' : '  Rollback ke snapshot ini? (y/n): ';
  if ((await ask(prompt)).trim().toLowerCase() !== 'y') { print('rollback', 'Dibatalkan.'); return; }
  try {
    const target = resolveWorkspacePath(filepath); const parent = path.dirname(target);
    if (parent && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(target, snap.content, 'utf8');
    print('rollback', currentMissing ? `${filepath} DIPULIHKAN dari snapshot ${snap.created_at}.` : `${filepath} dikembalikan ke snapshot ${snap.created_at}.`);
  } catch (err) { print('error', `Gagal tulis ${filepath}: ${err.message}`); }
}
