// M27: gerbang hasil squad berbasis bukti, bukan klaim worker.
export function reviewSquadResult({ results = [], finalSummary = '' } = {}) {
  if (!Array.isArray(results) || results.length === 0) return { ok: false, reason: 'hasil squad kosong' };
  if (typeof finalSummary !== 'string' || !finalSummary.trim()) return { ok: false, reason: 'ringkasan final kosong' };
  const failed = results.find(r => r && r.verified === false);
  if (failed) return { ok: false, reason: `task ${failed.id || '?'} gagal diverifikasi: ${failed.error || 'hasil gagal'}` };
  const noEvidence = results.find(r => !Array.isArray(r.evidence) || r.evidence.length === 0);
  if (noEvidence) return { ok: false, reason: `task ${noEvidence.id || '?'} tidak punya evidence/bukti` };
  return { ok: true, reason: 'semua task punya evidence dan tidak ada kegagalan terverifikasi' };
}
