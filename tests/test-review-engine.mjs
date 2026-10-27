// M52 RED: independent review engine — verdict berdasarkan bukti aktual.
import {
  REVIEW_VERDICT, runReview, validateAcceptance, buildReviewReport,
} from '../src/review-engine.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] validateAcceptance ──────────────────────────────────────────────────
{
  const contract = {
    acceptance: [
      { id: 'ac-1', text: 'Perintah test dijalankan dan exit code 0 dibuktikan', source: 'verification' },
      { id: 'ac-2', text: 'File target benar-benar ada setelah aksi', source: 'verification' },
      { id: 'ac-3', text: 'Ringkasan akhir hanya menyebut hal yang dibuktikan', source: 'baseline' },
    ],
  };
  const results = [
    { id: 'ac-1', status: 'completed', evidence: 'test PASS: 5 pass, 0 fail' },
    { id: 'ac-2', status: 'completed', evidence: 'file src/app.js terbaca' },
    { id: 'ac-3', status: 'completed', evidence: 'semua klaim punya bukti' },
  ];
  const v = validateAcceptance(contract, results);
  check('acceptance: semua terbukti -> APPROVE', v.verdict === REVIEW_VERDICT.APPROVE);
  check('acceptance: tidak ada finding', v.findings.length === 0);
}
{
  const contract = {
    acceptance: [
      { id: 'ac-1', text: 'Perintah test dijalankan', source: 'verification' },
      { id: 'ac-2', text: 'File target ada', source: 'verification' },
    ],
  };
  const results = [
    { id: 'ac-1', status: 'completed', evidence: 'test PASS' },
    { id: 'ac-2', status: 'pending' },  // belum terbukti
  ];
  const v = validateAcceptance(contract, results);
  check('acceptance: ada pending -> REJECT', v.verdict === REVIEW_VERDICT.REJECT);
  check('acceptance: finding menyebut kriteria pending', v.findings.some(f => f.criteriaId === 'ac-2'));
}
{
  const contract = {
    acceptance: [
      { id: 'ac-1', text: 'Test dijalankan', source: 'verification' },
    ],
  };
  const results = [
    { id: 'ac-1', status: 'completed', evidence: '' },  // completed tanpa evidence
  ];
  const v = validateAcceptance(contract, results);
  check('acceptance: completed tanpa evidence -> REJECT', v.verdict === REVIEW_VERDICT.REJECT);
  check('acceptance: finding BLOCKER', v.findings.some(f => f.severity === 'BLOCKER'));
}

// ── [2] runReview: berdasarkan history aktual ──────────────────────────────
{
  const contract = {
    goal: 'bikin file',
    acceptance: [
      { id: 'ac-1', text: 'File target benar-benar ada', source: 'verification' },
      { id: 'ac-2', text: 'Ringkasan akhir jujur', source: 'baseline' },
    ],
  };
  const history = [
    { action: 'edit', target: 'src/app.js', verified: true },
    { action: 'bash', command: 'node --check src/app.js', verified: true },
  ];
  const review = runReview({ contract, history, summary: 'File dibuat dan diverifikasi.' });
  check('review: verdict valid', [REVIEW_VERDICT.APPROVE, REVIEW_VERDICT.REJECT].includes(review.verdict));
  check('review: punya findings array', Array.isArray(review.findings));
  check('review: punya report', typeof review.report === 'string' && review.report.length > 0);
  check('review: evidence terverifikasi diakui', review.verifiedActions === 2);
}
{
  const contract = {
    goal: 'bikin file',
    acceptance: [
      { id: 'ac-1', text: 'File target benar-benar ada', source: 'verification' },
    ],
  };
  const history = [
    { action: 'edit', target: 'src/app.js', verified: false, error: 'syntax error' },
  ];
  const review = runReview({ contract, history, summary: 'Selesai.' });
  check('review: aksi gagal -> REJECT', review.verdict === REVIEW_VERDICT.REJECT);
  check('review: BLOCKER untuk aksi gagal', review.findings.some(f => f.severity === 'BLOCKER'));
  check('review: menyebut error', review.findings.some(f => /syntax error/i.test(f.message)));
}

// ── [3] runReview: summary palsu terdeteksi ────────────────────────────────
{
  const contract = {
    goal: 'bikin API login',
    acceptance: [
      { id: 'ac-1', text: 'Perintah test dijalankan dan exit code 0', source: 'verification' },
    ],
  };
  const history = [
    { action: 'edit', target: 'src/auth.js', verified: true },
  ];
  // Summary klaim test pass tapi TIDAK ada bash action di history
  const review = runReview({ contract, history, summary: 'Semua test pass dan API berfungsi sempurna.' });
  check('review: klaim test tanpa bukti -> REJECT', review.verdict === REVIEW_VERDICT.REJECT);
  check('review: BLOCKER untuk klaim tanpa bukti', review.findings.some(f => f.severity === 'BLOCKER'));
}

// ── [4] buildReviewReport ───────────────────────────────────────────────────
{
  const report = buildReviewReport({
    verdict: REVIEW_VERDICT.REJECT,
    findings: [
      { severity: 'BLOCKER', message: 'test belum dijalankan', criteriaId: 'ac-1' },
      { severity: 'WARNING', message: 'tidak ada file yang dibaca ulang' },
    ],
    verifiedActions: 1,
    totalActions: 3,
  });
  check('report: menyebut verdict', /REJECT/i.test(report));
  check('report: BLOCKER di atas', report.indexOf('BLOCKER') < report.indexOf('WARNING'));
  check('report: jumlah aksi', /1.*3|1\/3/i.test(report));
}
{
  const report = buildReviewReport({ verdict: REVIEW_VERDICT.APPROVE, findings: [], verifiedActions: 3, totalActions: 3 });
  check('report: APPROVE tanpa finding', /APPROVE/i.test(report) && !/BLOCKER/i.test(report));
}

// ── [5] Robustness ──────────────────────────────────────────────────────────
{
  check('review: null contract tidak crash', typeof runReview({ contract: null, history: [], summary: 'x' }) === 'object');
  check('review: null history tidak crash', typeof runReview({ contract: { acceptance: [] }, history: null, summary: 'x' }) === 'object');
  check('review: kosong -> REJECT (tidak ada bukti)',
    runReview({ contract: { acceptance: [{ id: 'a', text: 'test', source: 'verification' }] }, history: [], summary: 'x' }).verdict === REVIEW_VERDICT.REJECT);
}

console.log(`\n=== HASIL REVIEW-ENGINE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
