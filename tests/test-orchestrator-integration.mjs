// tests/test-orchestrator-integration.mjs — Integration M15: plan() lewat provider ASLI.
// Mock provider lokal balikin output LLM BERISIK (prose + fence + thinking) ->
// plan() harus parse & validate sukses. Backup/restore .settings.json.
// Written by K-sRouter

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

const { plan, parsePlan } = await import('../src/orchestrator.js');
const { askWithFallback } = await import('../src/providers.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

function makeServer(replies) {
  let i = 0;
  const s = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const content = replies[Math.min(i, replies.length - 1)]; i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const deny = async () => ({ approved: false, condition: null });

try {
  // ── A: output BERISIK (prose + fence + thinking) -> tetap ke-parse ──
  console.log('\n[A] plan() parse output berisi lewat provider asli');
  const messy = 'Oke, saya pecah dulu.\n```json\n'
    + JSON.stringify({ tasks: [
      { id: 1, role: 'researcher', brief: 'riset cara kerja X', dependsOn: null },
      { id: 2, role: 'coder', brief: 'implement X dari hasil riset', dependsOn: 1 },
    ] })
    + '\n```';
  let srv = await makeServer([messy]);
  fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 't', model: 'm', active: true }]));
  const rA = await plan('riset lalu bikin kodenya', askWithFallback);
  check('ok:true meski output berisi prose+fence', rA.ok && rA.tasks.length === 2, JSON.stringify(rA.problems));
  check('dependsOn antar task terbaca', rA.tasks?.[1]?.dependsOn === 1);
  srv.close();

  // ── B: attempt 1 role ngawang, attempt 2 valid -> retry jalan di jalur asli ──
  console.log('\n[B] retry feedback lewat provider asli');
  srv = await makeServer([
    JSON.stringify({ tasks: [{ id: 1, role: 'architect', brief: 'x', dependsOn: null }] }),
    JSON.stringify({ tasks: [{ id: 1, role: 'coder', brief: 'Perbaiki bug login di src/auth.js', dependsOn: null }] }),
  ]);
  fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 't', model: 'm', active: true }]));
  const rB = await plan('fix bug login', askWithFallback);
  check('retry: attempt1 invalid -> attempt2 valid', rB.ok && rB.attempts === 2, JSON.stringify(rB.problems));
  check('task hasil retry valid (role coder)', rB.tasks?.[0]?.role === 'coder');
  srv.close();

  // ── C: parsePlan standalone pada blob berisi (sanity, tanpa server) ──
  console.log('\n[C] parsePlan blob nyata');
  check('parse blob dg dua JSON -> ambil yang pertama utuh', parsePlan('x\n{"tasks":[{"id":1,"role":"coder","brief":"a","dependsOn":null}]}\ntambahan').tasks.length === 1);
} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
}

console.log(`\n=== HASIL M15 INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
