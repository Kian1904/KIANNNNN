// M24: bukti post-action dan gerbang penyelesaian.
// Verifier ini pure: runner yang membaca file/menjalankan command,
// lalu mengirim hasil aktual ke sini. Klaim model bukan bukti.

export function verifyAction(input = {}) {
  const action = input.action;
  if (action === 'edit') {
    if (input.actualContent === null || input.actualContent === undefined) {
      return { ok: false, reason: `target ${input.target || '(unknown)'} tidak ada setelah edit` };
    }
    if (String(input.actualContent) !== String(input.expectedContent ?? '')) {
      return { ok: false, reason: `isi ${input.target || '(unknown)'} berbeda dari yang diminta` };
    }
    return { ok: true, reason: 'isi file cocok setelah edit' };
  }
  if (action === 'bash') {
    const result = input.result || {};
    if (result.ok === true && Number(result.code) === 0) return { ok: true, reason: 'exit code 0' };
    return { ok: false, reason: `command gagal (exit ${result.code ?? 'unknown'})` };
  }
  if (action === 'web_fetch') {
    if (typeof input.text === 'string' && input.text.trim().length > 0) return { ok: true, reason: 'isi halaman terbaca' };
    return { ok: false, reason: 'isi halaman kosong atau tidak terbaca' };
  }
  if (action === 'web_search') {
    if (Array.isArray(input.results) && input.results.length > 0) return { ok: true, reason: 'hasil search tersedia' };
    return { ok: false, reason: 'search tidak menghasilkan sumber' };
  }
  if (action === 'read' || action === 'list_dir') {
    return input.ok === false ? { ok: false, reason: input.error || 'aksi baca gagal' } : { ok: true, reason: 'aksi baca berhasil' };
  }
  // Aksi yang memang hanya menghasilkan keputusan/status dicatat, tapi tidak
  // mengklaim verifikasi file/command yang tidak dijalankan.
  return { ok: input.ok !== false, reason: input.ok === false ? (input.error || 'aksi gagal') : 'aksi selesai' };
}

export function verifyCompletion(history = [], summary) {
  if (typeof summary !== 'string' || !summary.trim()) return { ok: false, reason: 'summary kosong' };
  const failed = history.find(h => h && h.verified === false);
  if (failed) return { ok: false, reason: `aksi ${failed.action || 'unknown'} belum terverifikasi: ${failed.error || 'hasil gagal'}` };
  return { ok: true, reason: 'summary ada dan semua aksi yang diverifikasi lolos' };
}
