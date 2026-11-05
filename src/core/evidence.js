// Core evidence mapping extracted from the task loop.
// This module is pure: it does not touch the filesystem, network, UI, or model.

/**
 * Map verified actions to acceptance criteria.
 * Claims and failed actions never count as evidence.
 *
 * @param {Array} history
 * @param {{acceptance?: Array}} contract
 * @returns {Array<{id:string,status:string,evidence?:string}>}
 */
export function evidenceForContract(history = [], contract = null) {
  const items = Array.isArray(history) ? history : [];
  const verified = items.filter(h => h && h.verified === true);
  const failed = items.filter(h => h && h.verified === false);

  const hasEditVerified = verified.some(h => ['edit', 'write', 'append', 'mkdir'].includes(h.action));
  const hasBashOk = verified.some(h => h.action === 'bash');
  const hasWebEvidence = verified.some(h => ['web_search', 'web_fetch'].includes(h.action));
  const hasReadBack = verified.some(h => ['read', 'list_dir'].includes(h.action));
  const hasAnyFailure = failed.length > 0;

  const results = [];
  const acceptance = Array.isArray(contract?.acceptance) ? contract.acceptance : [];

  for (const criterion of acceptance) {
    let evidence = '';

    if (criterion.source === 'constraint') {
      const violation = failed.find(h => h.error && /constraint|dilarang|ditolak|blocked/i.test(String(h.error)));
      if (hasAnyFailure && violation) continue;
      if (hasEditVerified || hasBashOk) {
        evidence = `aksi terverifikasi tercatat (${verified.length}) tanpa pelanggaran constraint`;
      }
    } else if (criterion.source === 'verification') {
      if (/test/i.test(criterion.text) && hasBashOk) evidence = 'perintah test/bash sukses dengan exit code 0';
      if (/file|berkas/i.test(criterion.text) && hasEditVerified) evidence = 'file berubah dan isinya dibaca ulang';
      if (/instalasi/i.test(criterion.text) && hasBashOk) evidence = 'command instalasi sukses';
    } else if (criterion.source === 'measurement') {
      if (hasBashOk && hasReadBack) evidence = 'angka dihitung dari output command dan pembacaan file aktual';
      else if (hasBashOk) evidence = 'angka dihitung dari output command aktual';
    } else if (criterion.source === 'evidence') {
      if (hasWebEvidence) evidence = 'sumber web aktual terbaca dan terverifikasi';
    } else if (criterion.source === 'diagnosis') {
      if (hasBashOk) evidence = 'output command aktual dipakai sebagai bukti diagnosis';
    } else if (hasEditVerified || hasBashOk || hasWebEvidence || hasReadBack) {
      evidence = `aksi nyata terverifikasi (${verified.length} aksi lolos pemeriksaan)`;
    }

    if (evidence) results.push({ id: criterion.id, status: 'completed', evidence });
    else results.push({ id: criterion.id, status: 'pending' });
  }

  return results;
}
