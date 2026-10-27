// M51 integration: test orchestrator jalan di jalur runTask ASLI.
// Bukti: test nyata dijalankan sebelum done, hasil di-parse, gagal = done ditolak.
// Written by K'

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

const TMP_HOME = fs.mkdtempSync(path.join(ROOT, '.tmp-kian-m51-home-'));
const WORK_DIR = fs.mkdtempSync(path.join(ROOT, '.tmp-kian-m51-work-'));
process.env.HOME = TMP_HOME;
process.env.K_STREAM = '0';
process.env.K_JOURNAL = '1';

const { runTask } = await import('../src/run-task.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

// Capture stdout supaya bisa cek output print()
function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => { chunks.push(String(chunk)); return orig(chunk, ...args); };
  return fn().then(result => {
    process.stdout.write = orig;
    return { result, stdout: chunks.join('') };
  }).catch(err => {
    process.stdout.write = orig;
    throw err;
  });
}

function makeServer(replies) {
  let i = 0;
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      const content = replies[Math.min(i, replies.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

// Mock: bikin file via write action, baru done. Tiap test pakai nama unik.
const writeCreate1 = 'REASONING: buat file\nACTION: write\nTARGET: hasil1.txt\n===CONTENT_START===\nhalo\n===CONTENT_END===';
const writeCreate2 = 'REASONING: buat file\nACTION: write\nTARGET: hasil2.txt\n===CONTENT_START===\nhalo\n===CONTENT_END===';
const writeCreate3 = 'REASONING: buat file\nACTION: write\nTARGET: hasil3.txt\n===CONTENT_START===\nhalo\n===CONTENT_END===';
const doneStep = 'REASONING: beres\nACTION: done\nSUMMARY: File dibuat dan test dijalankan.';

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const askApproval = async () => ({ approved: true, condition: null });
const noop = () => {};

try {
  // ── [1] Tanpa test runner -> orchestrator tidak blokir ───────────────────
  console.log('\n[1] project tanpa test runner: done tetap jalan');
  {
    const srv = await makeServer([writeCreate1, doneStep]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    const origCwd = process.cwd();
    process.chdir(WORK_DIR);
    const { result: out, stdout } = await captureStdout(() =>
      runTask('Bikin file hasil1.txt berisi halo', null, [], null,
        { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null));
    process.chdir(origCwd);
    srv.close();

    check('tanpa runner: task tidak crash', typeof out === 'string' && out.length > 0);
    check('tanpa runner: tidak ada error test orchestrator',
      !/test orchestrator gagal/i.test(stdout), stdout.slice(-200));
    check('tanpa runner: tidak ada M51 output',
      !/M51 test orchestrator/i.test(stdout), stdout.slice(-200));
  }

  // ── [2] Dengan test runner + test PASS ───────────────────────────────────
  console.log('\n[2] project dengan test runner: test dijalankan dan PASS');
  {
    fs.writeFileSync(path.join(WORK_DIR, 'package.json'), JSON.stringify({
      name: 'm51-test', scripts: { test: 'echo "=== TOTAL: 5 pass, 0 fail ===" && exit 0' }
    }));

    const srv = await makeServer([writeCreate2, doneStep]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    const origCwd = process.cwd();
    process.chdir(WORK_DIR);
    const { result: out, stdout } = await captureStdout(() =>
      runTask('Bikin file hasil2.txt berisi halo dan jalankan test', null, [], null,
        { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null));
    process.chdir(origCwd);
    srv.close();

    check('runner: task selesai tanpa loop limit', typeof out === 'string' && !/batas.*langkah/i.test(stdout), stdout.slice(-200));
    check('runner: test orchestrator terdeteksi', /M51 test orchestrator/i.test(stdout), stdout.slice(-300));
    check('runner: test PASS', /test PASS/i.test(stdout), stdout.slice(-300));
    check('runner: bukan FAIL', !/test FAIL/i.test(stdout));
  }

  // ── [3] Test FAIL -> done ditolak ────────────────────────────────────────
  console.log('\n[3] test FAIL: done ditolak oleh orchestrator');
  {
    fs.writeFileSync(path.join(WORK_DIR, 'package.json'), JSON.stringify({
      name: 'm51-test', scripts: { test: 'echo "FAIL test-auth.mjs  1 pass, 2 fail" && exit 1' }
    }));

    const srv = await makeServer([writeCreate3, doneStep]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    const origCwd = process.cwd();
    process.chdir(WORK_DIR);
    const { result: out, stdout } = await captureStdout(() =>
      runTask('Bikin file hasil3.txt berisi halo dan jalankan test', null, [], null,
        { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null));
    process.chdir(origCwd);
    srv.close();

    check('gagal: test FAIL terdeteksi', /test FAIL/i.test(stdout), stdout.slice(-300));
    check('gagal: done ditolak (bukan "File dibuat dan test dijalankan")',
      typeof out === 'string' && !/^File dibuat dan test dijalankan\.$/.test(out.trim()));
    check('gagal: failure detail di-print', /test FAIL|fail/i.test(stdout) && /fail/i.test(stdout), stdout.slice(-300));
  }
} catch (err) {
  fail++;
  console.log(`  ✗ EXCEPTION: ${err?.stack?.split('\n').slice(0, 4).join('\n') || err}`);
} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(WORK_DIR, { recursive: true, force: true }); } catch {}
}

console.log(`\n=== HASIL TEST-ORCHESTRATOR INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
