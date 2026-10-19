// tests/test-mcp-client.mjs — Kontrak mcp/client.js vs mock MCP server.
//
// Beda sama test-mcp.mjs (live-check ke server external, bisa SKIP kalau mati),
// test ini SELF-CONTAINED: dia nyalain mock server sendiri, jadi SELALU ngetes
// jalur beneran: discovery, session handshake, parse JSON DAN SSE, callTool,
// arg passthrough, error handling.
//
// Isolasi: HOME di-set ke tmp sebelum import registry, jadi ~/.krouter_data/
// connections.json user ASLI gak pernah ke-sentuh.
//
// Written by K-sRouter

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function finish() {
  console.log(`\n=== HASIL MCP-CLIENT: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Isolasi HOME SEBELUM registry ke-load (registry hitung path saat import) ──
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'knn-mcp-'));
process.env.HOME = TMP_HOME;

const { startMockMcpServer } = await import('./helpers/mock-mcp-server.mjs');
const registry = await import('../mcp/registry.js');
const client = await import('../mcp/client.js');

const server = await startMockMcpServer();

try {
  // ── [1] Registry (isolated) ───────────────────────────────────────────────
  console.log('\n[1] registry — storage terisolasi');
  check('connections.json user asli gak ke-sentuh',
    !fs.existsSync(path.join(os.homedir(), '.krouter_data', 'connections.json')));
  check('mulai dari kosong', registry.getActiveConnections().length === 0);

  registry.addConnection({ name: 'mock', url: server.url, active: true });
  check('addConnection -> 1 aktif', registry.getActiveConnections().length === 1);
  check('getActiveConnections kembalikan url bener',
    registry.getActiveConnections()[0].url === server.url);
  check('koneksi default aktif', registry.getConnection('mock')?.active === true);

  // ── [2] Discovery — mode JSON ─────────────────────────────────────────────
  console.log('\n[2] discoverTools — mode JSON polos');
  const toolsJson = await client.discoverTools();
  check('nemu 2 tool', toolsJson.length === 2, `dapat ${toolsJson.length}`);
  check('ada summarize', toolsJson.some(t => t.name === 'summarize'));
  check('ada echo', toolsJson.some(t => t.name === 'echo'));
  check('tool bawa metadata server (_serverUrl)', toolsJson.every(t => !!t._serverUrl));
  check('tool bawa nama koneksi (_serverName)', toolsJson.every(t => t._serverName === 'mock'));
  check('inputSchema ikut kebawa', !!toolsJson.find(t => t.name === 'summarize')?.inputSchema?.properties?.teks);

  // updateTools dipanggil client → cache tersimpan ke registry
  const cached = registry.getConnection('mock');
  check('tool ke-cache ke registry', (cached.tools || []).length === 2, `cache=${(cached.tools || []).length}`);
  check('lastConnected terisi setelah sukses', !!cached.lastConnected);

  // ── [3] Discovery — mode SSE ──────────────────────────────────────────────
  // Server beda URL (?sse=1) = connection beda, biar sessionIds client gak ngabuburit.
  console.log('\n[3] discoverTools — mode SSE stream');
  registry.addConnection({ name: 'mock-sse', url: server.sseUrl, active: true });
  const toolsSse = await client.discoverTools();
  // discoverTools ngediscover SEMUA koneksi aktif → JSON + SSE kebaca dua-duanya
  const fromSse = toolsSse.filter(t => t._serverName === 'mock-sse');
  check('SSE stream keparse jadi tool', fromSse.length === 2, `dapat ${fromSse.length}`);
  check('tool dari SSE bawa _serverUrl', fromSse.every(t => !!t._serverUrl));

  // ── [4] callTool — kontrak output ─────────────────────────────────────────
  console.log('\n[4] callTool');
  const hasil = await client.callTool('summarize',
    { teks: 'Riset dulu. Lalu bikin kodenya. Terakhir uji.', mode: 'poin' }, toolsJson);
  check('hasil string', typeof hasil === 'string', `tipe=${typeof hasil}`);
  check('hasil non-kosong', typeof hasil === 'string' && hasil.trim().length > 0);
  check('mode=poin ngeluarin bullet', typeof hasil === 'string' && hasil.includes('- '),
    `hasil="${String(hasil).slice(0, 80)}"`);

  const kalimat = await client.callTool('summarize',
    { teks: 'Satu kalimat. Dua kalimat.', mode: 'kalimat' }, toolsJson);
  check('mode=kalimat ngeluarin teks', typeof kalimat === 'string' && kalimat.trim().length > 0);

  const echo = await client.callTool('echo', { pesan: 'halo-dunia-123' }, toolsJson);
  check('arg ke-passthrough ke server', String(echo).includes('halo-dunia-123'), `echo="${String(echo).slice(0, 80)}`.slice(0, 100));

  // ── [5] Error handling ────────────────────────────────────────────────────
  console.log('\n[5] error handling');
  let errTool = null;
  try { await client.callTool('tool-ngawur', {}, toolsJson); } catch (e) { errTool = e; }
  check('tool tak dikenal -> error jelas', !!errTool && /tidak ditemukan/.test(errTool.message),
    errTool?.message || 'tidak melempar');

  let errArg = null;
  try { await client.callTool('summarize', { mode: 'poin' }, toolsJson); } catch (e) { errArg = e; }
  check('arg wajib hilang -> error dari server ke-propagate',
    !!errArg && /teks wajib string/.test(errArg.message), errArg?.message || 'tidak melempar');

  // ── [6] Server mati -> jangan nge-crash, balikin [] ────────────────────────
  console.log('\n[6] server unreachable');
  await server.close();
  const deadTools = await client.discoverTools();
  check('server mati -> discoverTools balikin [] (gak throw)', Array.isArray(deadTools) && deadTools.length === 0,
    JSON.stringify(deadTools));

  // Session invalid: koneksi nunjuk URL mati, harus tetep [] (bukan throw)
  const beforeLen = registry.getActiveConnections().length;
  check('koneksi tetap terdaftar walau server mati', registry.getActiveConnections().length === beforeLen);

} finally {
  await server.close().catch(() => {});
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
}

finish();
