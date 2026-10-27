// M55 RED: shared artifact registry — worker publish, discover, consume artifacts.
import {
  publishArtifact, discoverArtifacts, consumeArtifact,
  getArtifactChain, queryByTag, queryByType, getConsumerCount,
} from '../src/shared-artifacts.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] publishArtifact ─────────────────────────────────────────────────────
{
  const reg = { artifacts: new Map(), consumers: new Map() };
  const a = publishArtifact(reg, {
    type: 'evidence',
    source: 'researcher',
    tags: ['http', 'security'],
    data: { url: 'https://x.com', finding: 'HTTPS redirect' },
  });
  check('publish: punya id', typeof a.id === 'string' && a.id.length > 0);
  check('publish: type tercatat', a.type === 'evidence');
  check('publish: source tercatat', a.source === 'researcher');
  check('publish: tags tercatat', Array.isArray(a.tags) && a.tags.length === 2);
  check('publish: data tercatat', a.data.finding === 'HTTPS redirect');
  check('publish: terdaftar di registry', reg.artifacts.has(a.id));
}

// ── [2] discoverArtifacts ───────────────────────────────────────────────────
{
  const reg = { artifacts: new Map(), consumers: new Map() };
  publishArtifact(reg, { type: 'evidence', source: 'researcher', tags: ['http'], data: { q: 1 } });
  publishArtifact(reg, { type: 'test_result', source: 'test-orchestrator', tags: ['npm'], data: { passed: true } });
  publishArtifact(reg, { type: 'evidence', source: 'coder', tags: ['http', 'auth'], data: { q: 2 } });

  const all = discoverArtifacts(reg);
  check('discover: semua artifact', all.length === 3);

  const evidenceOnly = discoverArtifacts(reg, { type: 'evidence' });
  check('discover: filter by type', evidenceOnly.length === 2);

  const httpOnly = discoverArtifacts(reg, { tag: 'http' });
  check('discover: filter by tag', httpOnly.length === 2);

  const researcherOnly = discoverArtifacts(reg, { source: 'researcher' });
  check('discover: filter by source', researcherOnly.length === 1);
}

// ── [3] consumeArtifact ─────────────────────────────────────────────────────
{
  const reg = { artifacts: new Map(), consumers: new Map() };
  const a = publishArtifact(reg, { type: 'evidence', source: 'researcher', tags: [], data: {} });

  consumeArtifact(reg, a.id, 'coder');
  consumeArtifact(reg, a.id, 'reviewer');
  consumeArtifact(reg, a.id, 'coder');  // double consume

  const count = getConsumerCount(reg, a.id);
  check('consume: consumer tercatat', count === 2, `got ${count}`);  // unique consumers
  check('consume: consumer list', (reg.consumers.get(a.id) || new Set()).size === 2);
}

// ── [4] getArtifactChain ────────────────────────────────────────────────────
{
  const reg = { artifacts: new Map(), consumers: new Map() };
  const a1 = publishArtifact(reg, { type: 'evidence', source: 'researcher', tags: [], data: { step: 1 } });
  const a2 = publishArtifact(reg, { type: 'evidence', source: 'coder', tags: [], data: { step: 2 }, parentIds: [a1.id] });
  const a3 = publishArtifact(reg, { type: 'review', source: 'reviewer', tags: [], data: { step: 3 }, parentIds: [a2.id] });

  const chain = getArtifactChain(reg, a3.id);
  check('chain: root -> leaf', chain.length === 3, `got ${chain.length}`);
  check('chain: urutan benar', chain[0].id === a1.id && chain[2].id === a3.id);
}

// ── [5] queryByTag & queryByType ────────────────────────────────────────────
{
  const reg = { artifacts: new Map(), consumers: new Map() };
  publishArtifact(reg, { type: 'evidence', source: 'a', tags: ['x', 'y'], data: {} });
  publishArtifact(reg, { type: 'test_result', source: 'b', tags: ['x'], data: {} });
  publishArtifact(reg, { type: 'review', source: 'c', tags: ['z'], data: {} });

  check('queryByTag: x -> 2', queryByTag(reg, 'x').length === 2);
  check('queryByTag: z -> 1', queryByTag(reg, 'z').length === 1);
  check('queryByTag: ghost -> 0', queryByTag(reg, 'ghost').length === 0);
  check('queryByType: evidence -> 1', queryByType(reg, 'evidence').length === 1);
  check('queryByType: test_result -> 1', queryByType(reg, 'test_result').length === 1);
}

// ── [6] Robustness ──────────────────────────────────────────────────────────
{
  const reg = { artifacts: new Map(), consumers: new Map() };
  check('discover: empty registry -> []', discoverArtifacts(reg).length === 0);
  check('publish: tanpa tags tidak crash', typeof publishArtifact(reg, { type: 'x', source: 'y' }) === 'object');
  check('consume: id tidak dikenal tidak crash', (() => { try { consumeArtifact(reg, 'ghost', 'w'); return true; } catch { return false; } })());
  check('chain: id tidak dikenal -> []', getArtifactChain(reg, 'ghost').length === 0);
  check('consumerCount: id tidak dikenal -> 0', getConsumerCount(reg, 'ghost') === 0);
}

console.log(`\n=== HASIL SHARED-ARTIFACTS: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
