// tests/test-agent-integration.mjs — Integration test whitelist agent di loop runTask ASLI.
//
// Strategi: backup .settings.json asli -> tulis mock provider yang menunjuk ke
// HTTP server lokal (mengembalikan step LLM yang sudah di-script) -> jalankan
// runTask dengan agentConfig -> assert enforcement -> RESTORE di finally.
// Tidak ada jaringan eksternal, tidak ada shell yang benar-benar dijalankan
// (bash diblokir whitelist SEBELUM eksekusi).
//
// Written by K-sRouter

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

const { runTask } = await import('../src/run-task.js');
const { AGENTS } = await import('../src/agents.js');
const { createThread } = await import('../src/db.js');

// Pakai thread NYATA — caller asli (REPL/Telegram) selalu kirim threadId, jadi
// jalur {threadId,role,content} di logStep yang kita tes adalah jalur produksi.
const TID = createThread();

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

// ── Scripted LLM responses (urutan dipakai untuk tiap /chat/completions call) ──
function makeServer(script) {
  let i = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const content = script[Math.min(i, script.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const realSettings = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;

try {
  // ── Skenario A: researcher (TIDAK boleh bash) memilih bash 3x -> dipaksa stop ──
  console.log('\n[A] researcher diblokir pakai bash');
  const serverA = await makeServer([
    'REASONING: coba jalankan\nACTION: bash\nCOMMAND: echo hi',
    'REASONING: coba lagi\nACTION: bash\nCOMMAND: echo hi',
    'REASONING: coba lagi\nACTION: bash\nCOMMAND: echo hi',
  ]);
  const portA = serverA.address().port;
  fs.writeFileSync(SETTINGS, JSON.stringify([
    { name: 'mock', baseUrl: `http://127.0.0.1:${portA}/v1`, apiKey: 'test', model: 'mock-1', active: true }
  ]), 'utf8');

  const denyApproval = async () => ({ approved: false, condition: null });
  const outA = await runTask(
    'jalankan sesuatu', null, [], TID, null, null, null,
    () => false, denyApproval, AGENTS.researcher
  );
  check('runTask berhenti dengan pesan aksi terlarang',
    typeof outA === 'string' && outA.includes('aksi terlarang'), String(outA));
  serverA.close();

  // ── Skenario B: generic (agentConfig=null) TIDAK kena whitelist -> bash masuk ke approval ──
  console.log('\n[B] generic agent tidak kena whitelist');
  const serverB = await makeServer([
    'REASONING: jalankan\nACTION: bash\nCOMMAND: echo hi',
  ]);
  const portB = serverB.address().port;
  fs.writeFileSync(SETTINGS, JSON.stringify([
    { name: 'mock', baseUrl: `http://127.0.0.1:${portB}/v1`, apiKey: 'test', model: 'mock-1', active: true }
  ]), 'utf8');

  let approvalAsked = false;
  const denyApprovalB = async () => { approvalAsked = true; return { approved: false, condition: null }; };
  const outB = await runTask(
    'jalankan sesuatu', null, [], TID, null, null, null,
    () => false, denyApprovalB, null   // null = generic
  );
  check('generic: bash SAMPAI ke approval (bukan diblokir whitelist)', approvalAsked === true);
  check('generic: hasil = command dibatalkan', typeof outB === 'string' && outB.includes('dibatalkan'), String(outB));
  serverB.close();

  // ── Skenario C: reviewer DILARANG edit (read-only terhadap kode) ──
  // catat: reviewer BOLEH bash (buat test/lint) tapi TIDAK BOLEH edit.
  console.log('\n[C] reviewer blokir edit (read-only terhadap kode)');
  const serverC = await makeServer([
    'REASONING: perbaiki\nACTION: edit\nTARGET: x.js\n===CONTENT_START===\nbad\n===CONTENT_END===',
    'REASONING: perbaiki\nACTION: edit\nTARGET: x.js\n===CONTENT_START===\nbad\n===CONTENT_END===',
    'REASONING: perbaiki\nACTION: edit\nTARGET: x.js\n===CONTENT_START===\nbad\n===CONTENT_END===',
  ]);
  const portC = serverC.address().port;
  fs.writeFileSync(SETTINGS, JSON.stringify([
    { name: 'mock', baseUrl: `http://127.0.0.1:${portC}/v1`, apiKey: 'test', model: 'mock-1', active: true }
  ]), 'utf8');

  const outC = await runTask(
    'review kode', null, [], TID, null, null, null,
    () => false, denyApproval, AGENTS.reviewer
  );
  check('reviewer: edit diblokir whitelist (tidak boleh ubah kode)', typeof outC === 'string' && outC.includes('aksi terlarang'), String(outC));
  serverC.close();
} finally {
  // ── Restore .settings.json asli ──
  if (realSettings !== null) fs.writeFileSync(SETTINGS, realSettings, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
}

console.log(`\n=== HASIL INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
