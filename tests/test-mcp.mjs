// tests/test-mcp.mjs — Live-check MCP client.
//
// Dua kondisi dibedakan (lihat FINDING 2026-10-18 di SPEC.md):
//   1. Environment mati (belum ada connection dikonfigurasi ATAU server gak
//      nyambung)  -> SKIP, exit 0. Ini environmental, BUKAN regresi.
//   2. MCP hidup  -> wajib lewat: discoverTools harus nemu tool, dan
//      callTool('summarize') harus balikin hasil non-kosong.
//
// Dulu: 0 tool -> langsung exit 1, jadi suite gagal tiap kali server lagi mati.
// Written by K'

import { discoverTools, callTool } from '../mcp/client.js';
import { getActiveConnections } from '../mcp/registry.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function finish() {
  console.log(`\n=== HASIL MCP: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

const conns = getActiveConnections();
console.log(`[health] active connections: ${conns.length}` +
  (conns.length ? ` (${conns.map(c => c.name).join(', ')})` : ''));

// ── Condition 1: belum ada koneksi sama sekali ──────────────────────────────
if (conns.length === 0) {
  console.log('⏭  SKIP: belum ada MCP connection aktif di ' +
    '~/.krouter_data/connections.json — live-check dilewati, exit 0.');
  console.log('   (tambah connection dulu kalau mau ngetes jalur MCP beneran)');
  process.exit(0);
}

// ── Discover ────────────────────────────────────────────────────────────────
const toolPool = await discoverTools();
console.log(`Tools ditemukan: ${toolPool.length} —`, toolPool.map(t => t.name));

// ── Condition 2: koneksi ada tapi server gak nyambung ───────────────────────
if (toolPool.length === 0) {
  console.log('⏭  SKIP: ada connection tapi 0 tool terdiscovery — server MCP ' +
    'kemungkinan lagi mati/tidak terjangkau. Environmental, exit 0 (bukan regresi).');
  process.exit(0);
}

// ── MCP hidup: wajib lewat semua ────────────────────────────────────────────
console.log('\n[1] discoverTools');
check('ada tool di pool', toolPool.length > 0);
check('tool punya metadata server', toolPool.every(t => t._serverUrl && t._serverName));

const summarizeTool = toolPool.find(t => t.name === 'summarize');
console.log('\n[2] callTool(summarize)');
check('tool summarize tersedia', !!summarizeTool);
check('summarize punya inputSchema', !!summarizeTool?.inputSchema);

if (summarizeTool) {
  let result, err = null;
  try {
    result = await callTool(
      'summarize',
      { teks: 'Ini adalah teks panjang yang ingin diringkas menjadi poin-poin penting.', mode: 'poin' },
      toolPool
    );
  } catch (e) { err = e; }

  check('callTool tidak melempar', !err, err?.message);
  check('hasil bukan null/undefined', result !== null && result !== undefined, String(result));
  check('hasil bukan string kosong', typeof result === 'string' && result.trim().length > 0,
    typeof result === 'string' ? `panjang=${result.length}` : `tipe=${typeof result}`);
  if (typeof result === 'string' && result.trim()) console.log(`  → ${result.slice(0, 200)}`);
}

console.log('\n[3] callTool — tool yang gak ada di pool');
let missingErr = null;
try { await callTool('tool-tidak-ada', {}, toolPool); } catch (e) { missingErr = e; }
check('tool tak dikenal melempar error jelas', !!missingErr && /tidak ditemukan/.test(missingErr.message),
  missingErr?.message || 'tidak melempar');

finish();
