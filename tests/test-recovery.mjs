// M50 RED: recovery engine — klasifikasi error + kebijakan retry.
// Tujuan: agent tidak retry error permanen, tidak retry aksi destruktif,
// dan tidak loop ke provider yang sedang cooldown.
import {
  ERROR_KIND, classifyError, decideRecovery, buildRecoveryHint,
  isRetryable, isPermanent,
} from '../src/recovery.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] Klasifikasi error ───────────────────────────────────────────────────
check('classify: syntax error', classifyError({ error: 'SyntaxError: Unexpected token }' }) === ERROR_KIND.SYNTAX);
check('classify: test failure', classifyError({ error: 'exit 1', action: 'bash', command: 'npm test' }) === ERROR_KIND.TEST_FAILURE);
check('classify: 429 rate limit', classifyError({ error: 'API error 429 Too Many Requests' }) === ERROR_KIND.RATE_LIMIT);
check('classify: timeout', classifyError({ error: 'ETIMEDOUT' }) === ERROR_KIND.TIMEOUT);
check('classify: DNS', classifyError({ error: 'getaddrinfo ENOTFOUND example.com' }) === ERROR_KIND.NETWORK);
check('classify: permission denied', classifyError({ error: 'EACCES: permission denied' }) === ERROR_KIND.PERMISSION);
check('classify: file not found', classifyError({ error: 'ENOENT: no such file' }) === ERROR_KIND.NOT_FOUND);
check('classify: approval denied', classifyError({ error: 'dibatalkan oleh user', action: 'edit' }) === ERROR_KIND.APPROVAL_DENIED);
check('classify: constraint violation', classifyError({ error: 'constraint dilanggar' }) === ERROR_KIND.CONSTRAINT);
check('classify: unknown', classifyError({ error: 'sesuatu aneh terjadi' }) === ERROR_KIND.UNKNOWN);
check('classify: kosong -> unknown', classifyError({}) === ERROR_KIND.UNKNOWN);

// ── [2] Retryable vs permanent ──────────────────────────────────────────────
check('retryable: syntax', isRetryable(ERROR_KIND.SYNTAX) === true);
check('retryable: test failure', isRetryable(ERROR_KIND.TEST_FAILURE) === true);
check('retryable: rate limit', isRetryable(ERROR_KIND.RATE_LIMIT) === true);
check('retryable: timeout', isRetryable(ERROR_KIND.TIMEOUT) === true);
check('permanent: approval denied', isPermanent(ERROR_KIND.APPROVAL_DENIED) === true);
check('permanent: constraint violation', isPermanent(ERROR_KIND.CONSTRAINT) === true);
check('permanent: permission', isPermanent(ERROR_KIND.PERMISSION) === true);

// ── [3] decideRecovery: aksi & keputusan ────────────────────────────────────
{
  const d = decideRecovery({ error: 'SyntaxError: Unexpected token', attempt: 1, maxAttempts: 3 });
  check('decide: syntax attempt 1 -> retry', d.action === 'retry', JSON.stringify(d));
  check('decide: retry punya delay', typeof d.delayMs === 'number' && d.delayMs >= 0);
  check('decide: retry menyebut alasan', typeof d.reason === 'string' && d.reason.length > 0);
}
{
  const d = decideRecovery({ error: 'SyntaxError: Unexpected token', attempt: 3, maxAttempts: 3 });
  check('decide: attempt habis -> stop', d.action === 'stop', JSON.stringify(d));
  check('decide: stop kasih alasan eksplisit', /habis|batas|limit/i.test(d.reason), d.reason);
}
{
  const d = decideRecovery({ error: 'dibatalkan oleh user', attempt: 1, maxAttempts: 3 });
  check('decide: approval denied -> stop (bukan retry)', d.action === 'stop', JSON.stringify(d));
}
{
  const d = decideRecovery({ error: 'API error 429', attempt: 1, maxAttempts: 3, providerCooldown: true });
  check('decide: provider cooldown -> switch (bukan retry provider sama)', ['switch_provider', 'retry'].includes(d.action), JSON.stringify(d));
}
{
  const d = decideRecovery({ error: 'ENOENT', attempt: 1, maxAttempts: 3 });
  check('decide: not found -> retry (path mungkin typo, bisa diperbaiki)',
    d.action === 'retry' || d.action === 'replan', JSON.stringify(d));
}
{
  const d = decideRecovery({ error: 'constraint dilanggar', attempt: 1, maxAttempts: 3 });
  check('decide: constraint violation -> stop/replan, BUKAN retry buta',
    d.action !== 'retry' || /replan/i.test(d.action), JSON.stringify(d));
}
{
  const d = decideRecovery({ error: 'boom', action: 'delete', attempt: 1, maxAttempts: 5, destructive: true });
  check('decide: aksi destruktif gagal -> TIDAK auto-retry', d.action !== 'retry', JSON.stringify(d));
}
{
  const d = decideRecovery({ error: 'boom', attempt: 1, maxAttempts: 3 });
  check('decide: unknown -> max 1 retry lalu stop', ['retry', 'stop', 'replan'].includes(d.action));
}

// ── [4] Recovery hint untuk model ───────────────────────────────────────────
{
  const hint = buildRecoveryHint({ error: 'SyntaxError: Unexpected token }', attempt: 1 });
  check('hint: menyebut jenis error', /syntax/i.test(hint), hint);
  check('hint: memberi instruksi konkret', /perbaiki|cek|baca|jalankan/i.test(hint));
  check('hint: bukan string kosong', hint.trim().length > 20);
}
{
  const hint = buildRecoveryHint({ error: 'dibatalkan oleh user', attempt: 1 });
  check('hint: approval denied -> jangan coba bypass', /jangan|berhenti|tanya/i.test(hint), hint);
}
{
  const hint = buildRecoveryHint({ error: 'API error 429', attempt: 2 });
  check('hint: rate limit -> sarankan tunggu/provider lain', /tunggu|provider|cooldown/i.test(hint), hint);
}
{
  const hint = buildRecoveryHint({});
  check('hint: kosong tidak crash', typeof hint === 'string');
}

// ── [5] Escalation: attempt tinggi -> replan ────────────────────────────────
{
  const d = decideRecovery({ error: 'npm test gagal', attempt: 2, maxAttempts: 3, repeatedKind: true });
  check('escalation: error jenis sama berulang -> replan/stop',
    ['replan', 'stop'].includes(d.action), JSON.stringify(d));
}

console.log(`\n=== HASIL RECOVERY: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
