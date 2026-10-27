// M52: independent review engine — verdict berdasarkan bukti aktual, bukan klaim.
//
// Kenapa ini ada: contract gate M47 cek evidence per kriteria, tapi belum ada
// yang memverifikasi secara independen apakah (a) klaim di summary punya bukti,
// (b) aksi gagal tidak disembunyikan, (c) summary tidak berlebihan dibanding
// yang benar-benar dikerjakan.
//
// Written by K'

export const REVIEW_VERDICT = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
});

const SEVERITY_ORDER = { BLOCKER: 0, WARNING: 1, NIT: 2 };

/**
 * Validasi acceptance criteria terhadap results aktual.
 * @param {{acceptance: Array}} contract
 * @param {Array<{id:string,status:string,evidence:string}>} results
 * @returns {{verdict:string, findings:Array}}
 */
export function validateAcceptance(contract, results = []) {
  const findings = [];
  const acceptance = Array.isArray(contract?.acceptance) ? contract.acceptance : [];
  const byId = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    if (r && r.id) byId.set(r.id, r);
  }

  for (const criterion of acceptance) {
    const res = byId.get(criterion.id);
    if (!res) {
      findings.push({
        severity: 'BLOCKER',
        message: `kriteria belum diperiksa: ${criterion.text}`,
        criteriaId: criterion.id,
      });
      continue;
    }
    if (res.status !== 'completed') {
      findings.push({
        severity: 'BLOCKER',
        message: `kriteria belum terbukti: ${criterion.text}`,
        criteriaId: criterion.id,
      });
      continue;
    }
    if (!res.evidence || !String(res.evidence).trim()) {
      findings.push({
        severity: 'BLOCKER',
        message: `kriteria diklaim selesai tapi tanpa bukti: ${criterion.text}`,
        criteriaId: criterion.id,
      });
    }
  }

  const verdict = findings.some(f => f.severity === 'BLOCKER')
    ? REVIEW_VERDICT.REJECT
    : REVIEW_VERDICT.APPROVE;

  return { verdict, findings };
}

/**
 * Review independen: baca history aktual, validasi acceptance, deteksi klaim palsu.
 *
 * @param {{contract?: object, history?: Array, summary?: string}} input
 * @returns {{verdict:string, findings:Array, verifiedActions:number, totalActions:number, report:string}}
 */
export function runReview(input = {}) {
  const contract = input.contract || { acceptance: [] };
  const history = Array.isArray(input.history) ? input.history : [];
  const summary = String(input.summary || '');

  const verifiedActions = history.filter(h => h && h.verified === true).length;
  const failedActions = history.filter(h => h && h.verified === false);
  const totalActions = history.length;

  const findings = [];

  // 1. Aksi gagal yang mungkin disembunyikan.
  for (const failed of failedActions) {
    findings.push({
      severity: 'BLOCKER',
      message: `aksi ${failed.action || 'unknown'} gagal: ${failed.error || 'tidak diketahui'}`,
    });
  }

  // 2. Klaim di summary yang tidak punya bukti di history.
  const claimChecks = detectUnsupportedClaims(summary, history);
  findings.push(...claimChecks);

  // 3. Validasi acceptance criteria.
  const evidenceResults = evidenceFromHistory(history, contract);
  const acceptanceResult = validateAcceptance(contract, evidenceResults);
  findings.push(...acceptanceResult.findings);

  // 4. Summary kosong.
  if (!summary.trim()) {
    findings.push({ severity: 'BLOCKER', message: 'summary kosong — tidak ada yang bisa direview' });
  }

  // 5. Tidak ada aksi sama sekali tapi klaim selesai.
  if (totalActions === 0 && summary.trim()) {
    findings.push({
      severity: 'BLOCKER',
      message: 'klaim selesai tapi tidak ada aksi yang tercatat',
    });
  }

  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] || 9) - (SEVERITY_ORDER[b.severity] || 9));

  const verdict = findings.some(f => f.severity === 'BLOCKER')
    ? REVIEW_VERDICT.REJECT
    : REVIEW_VERDICT.APPROVE;

  const report = buildReviewReport({ verdict, findings, verifiedActions, totalActions });

  return { verdict, findings, verifiedActions, totalActions, report };
}

/**
 * Deteksi klaim di summary yang tidak didukung bukti di history.
 */
function detectUnsupportedClaims(summary, history) {
  const findings = [];
  const text = String(summary || '').toLowerCase();
  const hasBash = history.some(h => h && h.action === 'bash' && h.verified === true);
  const hasEdit = history.some(h => h && ['edit', 'write', 'append', 'mkdir'].includes(h.action) && h.verified === true);
  const hasWeb = history.some(h => h && ['web_search', 'web_fetch'].includes(h.action) && h.verified === true);
  const hasRead = history.some(h => h && ['read', 'list_dir'].includes(h.action) && h.verified === true);

  // Klaim test tanpa bukti bash.
  if (/\b(test|tes|uji|spec)\b.*\b(pass|lulus|berhasil|lewat|sukses)\b/i.test(text) && !hasBash) {
    findings.push({
      severity: 'BLOCKER',
      message: 'summary klaim test pass tapi tidak ada aksi bash yang terverifikasi',
    });
  }

  // Klaim file dibuat/diubah tanpa bukti edit.
  if (/\b(file|berkas|kode|code)\b.*\b(dibuat|diubah|diperbaiki|dibuat ulang)\b/i.test(text) && !hasEdit) {
    findings.push({
      severity: 'BLOCKER',
      message: 'summary klaim file dibuat/diubah tapi tidak ada aksi edit yang terverifikasi',
    });
  }

  // Klaim riset tanpa bukti web.
  if (/\b(riset|research|sumber|source|ditemukan)\b/i.test(text) && !hasWeb && !hasRead) {
    findings.push({
      severity: 'WARNING',
      message: 'summary klaim riset tapi tidak ada aksi web/read yang terverifikasi',
    });
  }

  return findings;
}

/**
 * Petakan history ke format results untuk validateAcceptance.
 * (Mirip evidenceForContract di run-task.js tapi lebih sederhana — untuk review.)
 */
function evidenceFromHistory(history, contract) {
  const verified = history.filter(h => h && h.verified === true);
  const hasEdit = verified.some(h => ['edit', 'write', 'append', 'mkdir'].includes(h.action));
  const hasBash = verified.some(h => h.action === 'bash');
  const hasWeb = verified.some(h => ['web_search', 'web_fetch'].includes(h.action));
  const hasRead = verified.some(h => ['read', 'list_dir'].includes(h.action));

  const acceptance = Array.isArray(contract?.acceptance) ? contract.acceptance : [];
  return acceptance.map(criterion => {
    let evidence = '';
    if (criterion.source === 'verification') {
      if (/test/i.test(criterion.text) && hasBash) evidence = 'test/bash terverifikasi';
      if (/file|berkas/i.test(criterion.text) && hasEdit) evidence = 'file terverifikasi';
    } else if (criterion.source === 'evidence') {
      if (hasWeb) evidence = 'sumber web terverifikasi';
    } else if (criterion.source === 'measurement') {
      if (hasBash) evidence = 'pengukuran aktual';
    } else {
      // baseline
      if (hasEdit || hasBash || hasWeb || hasRead) evidence = 'aksi nyata terverifikasi';
    }
    return {
      id: criterion.id,
      status: evidence ? 'completed' : 'pending',
      evidence,
    };
  });
}

/**
 * Bangun laporan review yang bisa dibaca manusia.
 */
export function buildReviewReport({ verdict, findings = [], verifiedActions = 0, totalActions = 0 }) {
  const lines = [];
  lines.push(`VERDICT: ${verdict}`);
  lines.push(`Aksi terverifikasi: ${verifiedActions}/${totalActions}`);

  const blockers = findings.filter(f => f.severity === 'BLOCKER');
  const warnings = findings.filter(f => f.severity === 'WARNING');
  const nits = findings.filter(f => f.severity === 'NIT');

  if (blockers.length) {
    lines.push('');
    lines.push('BLOCKER:');
    for (const f of blockers) lines.push(`  ✗ ${f.message}`);
  }
  if (warnings.length) {
    lines.push('');
    lines.push('WARNING:');
    for (const f of warnings) lines.push(`  ⚠ ${f.message}`);
  }
  if (nits.length) {
    lines.push('');
    lines.push('NIT:');
    for (const f of nits) lines.push(`  ℹ ${f.message}`);
  }
  if (findings.length === 0) {
    lines.push('');
    lines.push('Tidak ada temuan signifikan.');
  }

  return lines.join('\n');
}
