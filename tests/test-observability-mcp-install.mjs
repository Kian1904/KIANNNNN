// M65+M66+M67 RED: observability + MCP health + install hardening.
import {
  createTrace, logEvent, getTraceReport, exportTrace,
} from '../src/tracer.js';
import {
  healthCheck, validateServerConfig, formatHealthReport,
} from '../src/mcp-health.js';
import {
  validateInstall, checkDependencies, getInstallReport,
} from '../src/install-check.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── M65: tracer ─────────────────────────────────────────────────────────────
{
  const t = createTrace({ taskId: 'tr1', label: 'bikin API' });
  check('trace: punya id', t.taskId === 'tr1');
  check('trace: events kosong', t.events.length === 0);

  logEvent(t, { type: 'action', action: 'edit', target: 'a.js', durationMs: 100 });
  logEvent(t, { type: 'action', action: 'bash', command: 'npm test', durationMs: 500 });
  logEvent(t, { type: 'done', summary: 'selesai' });

  check('trace: 3 events', t.events.length === 3);
  check('trace: events punya timestamp', t.events.every(e => typeof e.at === 'string'));

  const report = getTraceReport(t);
  check('report: ada taskId', report.includes('tr1'));
  check('report: ada events count', /3.*event|event.*3/i.test(report));

  const exported = exportTrace(t);
  check('export: valid JSON', typeof exported === 'string' && JSON.parse(exported) != null);
}

// ── M66: MCP health ─────────────────────────────────────────────────────────
{
  const config = { name: 'test-server', url: 'http://localhost:9999', timeout: 5000 };
  const v = validateServerConfig(config);
  check('mcp: valid config -> ok', v.valid === true);

  const v2 = validateServerConfig({ name: '', url: '' });
  check('mcp: invalid config -> errors', v2.valid === false && v2.errors.length > 0);

  const v3 = validateServerConfig({});
  check('mcp: empty config -> errors', v3.valid === false);
}
{
  const h = await healthCheck({ name: 'ghost', url: 'http://localhost:1', timeout: 100 });
  check('health: unreachable -> status down', h.status === 'down');
  check('health: ada error', typeof h.error === 'string');
}
{
  const report = formatHealthReport([{ name: 's1', status: 'up' }, { name: 's2', status: 'down', error: 'timeout' }]);
  check('report: tidak kosong', report.length > 0);
  check('report: ada s1', report.includes('s1'));
}

// ── M67: install check ──────────────────────────────────────────────────────
{
  const v = validateInstall({ requiredFiles: ['package.json', 'index.js'] });
  check('install: valid files -> ok', v.valid === true);

  const v2 = validateInstall({ requiredFiles: ['ghost-file-xyz.js'] });
  check('install: missing file -> error', v2.valid === false);

  const deps = checkDependencies(['node', 'npm']);
  check('deps: node ada', deps.find(d => d.name === 'node')?.found === true);
  check('deps: npm ada', deps.find(d => d.name === 'npm')?.found === true);

  const report = getInstallReport({ files: ['package.json'], deps: [{ name: 'node', found: true }] });
  check('install report: tidak kosong', report.length > 0);
}

console.log(`\n=== HASIL OBSERVABILITY+MCP+INSTALL: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
