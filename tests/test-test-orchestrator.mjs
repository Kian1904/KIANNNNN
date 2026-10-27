// M51 RED: test orchestrator — auto-detect runner, parse output, structured result.
import {
  detectTestRunner, buildTestCommand, parseTestOutput,
} from '../src/test-orchestrator.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] detectTestRunner ────────────────────────────────────────────────────
{
  const r = detectTestRunner({ files: ['package.json'] });
  check('detect: package.json -> npm/node runner', r && r.runner === 'npm');
}
{
  const r = detectTestRunner({ files: ['go.mod'] });
  check('detect: go.mod -> go test', r && r.runner === 'go');
}
{
  const r = detectTestRunner({ files: ['pyproject.toml'] });
  check('detect: pyproject.toml -> python runner', r && r.runner === 'python');
}
{
  const r = detectTestRunner({ files: ['readme.md'] });
  check('detect: no marker -> null', r === null);
}

// ── [2] buildTestCommand ────────────────────────────────────────────────────
{
  const cmd = buildTestCommand({ runner: 'npm' });
  check('build: npm command', typeof cmd === 'string' && cmd.includes('test'));
}
{
  const cmd = buildTestCommand({ runner: 'go' });
  check('build: go command', typeof cmd === 'string' && cmd.includes('go test'));
}
{
  const cmd = buildTestCommand({ runner: null });
  check('build: null runner -> null', cmd === null);
}

// ── [3] parseTestOutput ─────────────────────────────────────────────────────
{
  const out = 'ok  src/auth.mjs  3 pass, 0 fail\n=== TOTAL: 3 pass, 0 fail ===';
  const p = parseTestOutput(out, 'npm');
  check('parse: exit ok detected', p.passed === true);
  check('parse: counts extracted', p.testsPassed >= 3 || p.summary.includes('3 pass'));
}
{
  const out = 'FAIL test-auth.mjs  1 pass, 2 fail\nError: expected true';
  const p = parseTestOutput(out, 'npm');
  check('parse: failure detected', p.passed === false);
  check('parse: error snippet captured', p.failures.length > 0 || p.summary.includes('fail'));
}
{
  const p = parseTestOutput('', 'npm');
  check('parse: empty output -> failed', p.passed === false);
}
{
  const p = parseTestOutput('ok 1 - suite\nok 2 - other\n1..2', 'npm');
  check('parse: TAP format recognized', p.passed === true);
}

console.log(`\n=== HASIL TEST-ORCHESTRATOR: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
