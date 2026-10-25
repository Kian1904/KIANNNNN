// M50 integration: recovery engine bekerja di jalur runTask ASLI.
// Bukti: bash gagal -> hint spesifik disuntik, bukan retry buta.
// Bash gagal terus -> agent berhenti karena recovery, bukan loop 25x.
// Written by K'

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m50-int-'));
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m50-work-'));
process.env.HOME = TMP_HOME;
process.env.K_STREAM = '0';

const { runTask } = await import('../src/run-task.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

function makeServer(replies) {
  let i = 0;
  const payloads = [];
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      payloads.push(b);
      const content = replies[Math.min(i, replies.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ s, payloads, count: () => i })));
}

const bashFail = 'REASONING: coba jalankan\nACTION: bash\nCOMMAND: exit 7';
const doneStep = 'REASONING: beres\nACTION: done\nSUMMARY: Sudah dijalankan.';

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const askApproval = async () => ({ approved: true, condition: null });
const noop = () => {};

try {
  // ── [1] Bash gagal -> hint recovery spesifik disuntik ke model ──────────
  console.log('\n[1] bash gagal memicu hint recovery spesifik');
  {
    const srv = await makeServer([bashFail, doneStep]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.s.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    await runTask('jalankan sesuatu lalu selesaikan', null, [], null,
      { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null);
    srv.s.close();

    const payload = srv.payloads.join('\n');
    check('recovery: hint [RECOVERY: ...] dikirim ke model', /\[RECOVERY:/.test(payload), payload.slice(-400));
    check('recovery: hint menyebut perbaikan, bukan sekadar error',
      /perbaiki|baca|cek|jalankan ulang/i.test(payload));
  }

  // ── [2] Bash gagal berulang -> berhenti, bukan loop maksimal ────────────
  console.log('\n[2] gagal berulang dihentikan recovery engine');
  {
    const srv = await makeServer([bashFail]);   // SELALU gagal
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.s.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    const out = await runTask('jalankan command yang selalu gagal', null, [], null,
      { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null);
    srv.s.close();

    check('recovery: agent berhenti sebelum 25 langkah', srv.count() < 25, `panggilan=${srv.count()}`);
    check('recovery: hasil menyebut dihentikan recovery',
      typeof out === 'string' && /recovery/i.test(out), JSON.stringify(out && out.slice(0, 160)));
    check('recovery: bukan status sukses palsu',
      typeof out === 'string' && !/^Sudah dijalankan\.$/.test(out.trim()));
  }
} catch (err) {
  fail++;
  console.log(`  ✗ EXCEPTION: ${err?.stack?.split('\n').slice(0, 4).join('\n') || err}`);
} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(CWD, { recursive: true, force: true }); } catch {}
}

console.log(`\n=== HASIL RECOVERY INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
