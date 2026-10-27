// M53 RED: artifact provenance system — setiap bukti punya ID, sumber, dan jejak.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createArtifact, listArtifacts, getArtifact, chainArtifacts,
  ARTIFACT_TYPE, validateProvenance,
} from '../src/artifact-registry.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] createArtifact ──────────────────────────────────────────────────────
{
  const a = createArtifact({
    type: ARTIFACT_TYPE.FILE_CHANGE,
    source: 'action:edit',
    data: { target: 'src/app.js', action: 'edit' },
  });
  check('create: punya id unik', typeof a.id === 'string' && a.id.length > 0);
  check('create: punya type', a.type === ARTIFACT_TYPE.FILE_CHANGE);
  check('create: punya source', a.source === 'action:edit');
  check('create: punya timestamp', typeof a.at === 'string' && a.at.length > 0);
  check('create: data tersimpan', a.data.target === 'src/app.js');
  check('create: provenance kosong awalnya', Array.isArray(a.provenance) && a.provenance.length === 0);
}
{
  const a1 = createArtifact({ type: ARTIFACT_TYPE.TEST_RESULT, source: 'test-orchestrator', data: { passed: true } });
  const a2 = createArtifact({ type: ARTIFACT_TYPE.TEST_RESULT, source: 'test-orchestrator', data: { passed: false } });
  check('create: id unik antar artifact', a1.id !== a2.id);
}

// ── [2] listArtifacts ───────────────────────────────────────────────────────
{
  const dir = path.join(os.tmpdir(), 'kian-m53-test');
  const a1 = createArtifact({ type: ARTIFACT_TYPE.EVIDENCE, source: 'web_fetch', data: { url: 'https://x.com' }, dir });
  const a2 = createArtifact({ type: ARTIFACT_TYPE.FILE_CHANGE, source: 'action:write', data: { target: 'a.js' }, dir });
  const list = listArtifacts(dir);
  check('list: menemukan artifact yang dibuat', list.length >= 2);
  check('list: hanya artifact yang valid', list.every(a => a.id && a.type));
  check('list: sorted by timestamp', list.length <= 1 || list[0].at <= list[1].at);
}

// ── [3] getArtifact ─────────────────────────────────────────────────────────
{
  const dir = path.join(os.tmpdir(), 'kian-m53-test');
  const a = createArtifact({ type: ARTIFACT_TYPE.EVIDENCE, source: 'bash', data: { cmd: 'npm test' }, dir });
  const found = getArtifact(a.id, dir);
  check('get: artifact ditemukan', found && found.id === a.id);
  check('get: data lengkap', found.data.cmd === 'npm test');
  check('get: id tidak dikenal -> null', getArtifact('ghost-id', dir) === null);
}

// ── [4] chainArtifacts ──────────────────────────────────────────────────────
{
  const a1 = createArtifact({ type: ARTIFACT_TYPE.EVIDENCE, source: 'web_search', data: { q: 'x' } });
  const a2 = createArtifact({ type: ARTIFACT_TYPE.EVIDENCE, source: 'web_fetch', data: { url: 'y' } });
  const a3 = createArtifact({ type: ARTIFACT_TYPE.REVIEW, source: 'review-engine', data: { verdict: 'APPROVE' } });

  chainArtifacts(a2, a1);  // a2 berasal dari a1
  chainArtifacts(a3, a2);  // a3 berasal dari a2

  check('chain: a2 punya parent a1', a2.provenance.includes(a1.id));
  check('chain: a3 punya parent a2', a3.provenance.includes(a2.id));
  check('chain: a1 tidak punya parent', a1.provenance.length === 0);
}

// ── [5] validateProvenance ──────────────────────────────────────────────────
{
  const a1 = createArtifact({ type: ARTIFACT_TYPE.EVIDENCE, source: 'bash', data: {} });
  const a2 = createArtifact({ type: ARTIFACT_TYPE.TEST_RESULT, source: 'test', data: {} });
  chainArtifacts(a2, a1);

  const v = validateProvenance(a2, [a1, a2]);
  check('validate: chain valid', v.valid === true);
  check('validate: tidak ada masalah', v.problems.length === 0);
}
{
  const a1 = createArtifact({ type: ARTIFACT_TYPE.EVIDENCE, source: 'bash', data: {} });
  const a2 = createArtifact({ type: ARTIFACT_TYPE.TEST_RESULT, source: 'test', data: {} });
  chainArtifacts(a2, a1);

  // Parent hilang dari registry
  const v = validateProvenance(a2, [a2]);
  check('validate: parent hilang -> invalid', v.valid === false);
  check('validate: masalah disebutkan', v.problems.length > 0);
}
{
  const v = validateProvenance(null, []);
  check('validate: null artifact -> invalid', v.valid === false);
}

// ── [6] ARTIFACT_TYPE ───────────────────────────────────────────────────────
{
  check('type: EVIDENCE ada', ARTIFACT_TYPE.EVIDENCE === 'evidence');
  check('type: FILE_CHANGE ada', ARTIFACT_TYPE.FILE_CHANGE === 'file_change');
  check('type: TEST_RESULT ada', ARTIFACT_TYPE.TEST_RESULT === 'test_result');
  check('type: REVIEW ada', ARTIFACT_TYPE.REVIEW === 'review');
  check('type: WORKER_RESULT ada', ARTIFACT_TYPE.WORKER_RESULT === 'worker_result');
}

// ── [7] Robustness ──────────────────────────────────────────────────────────
{
  check('create: tanpa data tidak crash', typeof createArtifact({ type: 'evidence', source: 'x' }) === 'object');
  check('chain: null tidak crash', (() => { try { chainArtifacts(null, null); return true; } catch { return false; } })());
  check('list: dir tidak ada -> array kosong', listArtifacts(path.join(os.tmpdir(), 'kian-m53-ghost')).length === 0);
}

// Cleanup
try { fs.rmSync(path.join(os.tmpdir(), 'kian-m53-test'), { recursive: true, force: true }); } catch {}

console.log(`\n=== HASIL ARTIFACT-REGISTRY: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
