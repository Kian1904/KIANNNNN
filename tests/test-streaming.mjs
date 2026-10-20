// tests/test-streaming.mjs — Kontrak streaming di src/providers.js.
//
// Self-contained: nyalain mock SSE server sendiri, jadi jalur streaming beneran
// keuji (chunk-per-chunk, Content-Type detection, fallback).
//
// Isolasi: providers-registry.js baca `<repo>/.settings.json` — jadi test ini
// nyalin src/ + package.json ke tmp, lalu nulis .settings.json di SALINAN itu.
// .settings.json asli user gak pernah ke-sentuh. .env asli juga gak kebaca.
//
// Written by K-sRouter

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function finish() {
  console.log(`\n=== HASIL STREAMING: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

// ── Sandbox: salin src/ ke tmp, jangan sentuh repo asli ──────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'knn-sse-'));
fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });

const { startMockSseServer } = await import('./helpers/mock-sse-server.mjs');
const server = await startMockSseServer({ tokens: ['Halo', ' ', 'dari', ' ', 'mock', '!'] });
const EXPECTED = 'Halo dari mock!';

function writeSettings(pathSuffix, name) {
  fs.writeFileSync(path.join(TMP, '.settings.json'), JSON.stringify([
    { name, baseUrl: server.url + pathSuffix, apiKey: '', model: 'mock-model', active: true },
  ], null, 2));
}

writeSettings('', 'mockstream');

// Import dari SALINAN, bukan repo asli. Cache-buster biar tiap skenario fresh.
const providers = await import(path.join(TMP, 'src', 'providers.js'));

try {
  console.log('\n[1] Jalur non-streaming (default, backward compat)');
  const plain = await providers.askWithFallback('sys', 'usr');
  check('balikin teks utuh', plain === EXPECTED, JSON.stringify(plain));
  check('request TIDAK minta stream', !server.requests.some(r => r.stream === true));

  console.log('\n[2] Jalur streaming (onToken)');
  const chunks = [];
  const streamed = await providers.askWithFallback('sys', 'usr', {
    onToken: (t) => chunks.push(t),
  });
  check('return value tetap teks utuh', streamed === EXPECTED, JSON.stringify(streamed));
  check('callback dipanggil > 1 kali (beneran stream)', chunks.length > 1, `dapat ${chunks.length} chunk`);
  check('chunk digabung = teks utuh', chunks.join('') === EXPECTED, JSON.stringify(chunks.join('')));
  check('request dikirim dengan stream:true', server.requests.some(r => r.stream === true));

  console.log('\n[3] opts tanpa onToken = perilaku lama (non-streaming)');
  const noCb = await providers.askWithFallback('sys', 'usr', {});
  check('tetap balikin teks utuh', noCb === EXPECTED, JSON.stringify(noCb));

  console.log('\n[4] Kesepakatan tanda tangan fungsi');
  check('askWithFallback terima 3 argumen (sys, usr, opts)', providers.askWithFallback.length === 3,
    `length=${providers.askWithFallback.length}`);
  check('fallbackState nyatet provider terakhir', providers.fallbackState.lastProvider === 'MOCKSTREAM',
    String(providers.fallbackState.lastProvider));

  // ── [5] Provider "budek": diminta stream, balikin JSON biasa ───────────────
  console.log('\n[5] Provider budek — minta stream tapi balikin JSON');
  writeSettings('/?mode=json-ignores-stream', 'budek');
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true });
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
  const providers2 = await import(path.join(TMP, 'src', 'providers.js') + '?v=2');
  const chunks2 = [];
  const budek = await providers2.askWithFallback('sys', 'usr', { onToken: (t) => chunks2.push(t) });
  check('tetap balikin teks (fallback ke jalur JSON)', budek === EXPECTED, JSON.stringify(budek));
  check('callback tetap dipanggil sekali dgn teks penuh', chunks2.join('') === EXPECTED,
    JSON.stringify(chunks2.join('')));

  // ── [6] Stream cuma reasoning → dianggap gagal ─────────────────────────────
  console.log('\n[6] Stream cuma reasoning tanpa content');
  writeSettings('/?mode=reasoning-only', 'reasoning');
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true });
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(TMP, 'src'), { recursive: true });
  const providers3 = await import(path.join(TMP, 'src', 'providers.js') + '?v=3');
  let reasonErr = null;
  try {
    await providers3.askWithFallback('sys', 'usr', { onToken: () => {} });
  } catch (e) { reasonErr = e; }
  check('gagal (bukan return kosong) → cascade bisa lanjut', !!reasonErr,
    reasonErr ? 'melempar: ' + reasonErr.message.slice(0, 60) : 'TIDAK melempar');

} finally {
  await server.close().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true });
}

finish();
