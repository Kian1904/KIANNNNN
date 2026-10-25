// tests/test-contract-gate-integration.mjs — M47 integration lewat runTask ASLI.
//
// Membuktikan gerbang kontrak bekerja di jalur produksi, bukan cuma di helper:
//  1. Model langsung bilang "done" tanpa kerja apa pun  -> DITOLAK, loop lanjut.
//  2. Model kerja nyata (bash exit 0) lalu done           -> DITERIMA.
// Mock provider lokal, .settings.json di-backup/restore.
// Written by K'

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

// HOME diisolasi SEBELUM import db.js (path dihitung saat module load).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m47-'));
process.env.HOME = TMP_HOME;
process.env.K_STREAM = '0';

const { runTask } = await import('../src/run-task.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

function makeServer(replies) {
  let i = 0;
  const seen = [];
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      seen.push(b);
      const content = replies[Math.min(i, replies.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ server: s, seen, count: () => i })));
}

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;

const doneOnly = 'REASONING: sudah beres semua\nACTION: done\nSUMMARY: Semua sudah saya kerjakan dengan benar.';
const mkdirOk = 'REASONING: siapkan direktori target\nACTION: bash\nCOMMAND: mkdir -p src && echo dibuat\nSUMMARY: direktori disiapkan';
const writeOk = 'REASONING: buat file nyata\nACTION: write\nTARGET: src/app.js\n===CONTENT_START===\nmodule.exports = 1;\n===CONTENT_END===';
const doneAfter = 'REASONING: bukti sudah ada\nACTION: done\nSUMMARY: Sudah dibuat dan dibuktikan dengan pembacaan file + exit code 0.';

// Untuk task yang menuntut test: jalankan test nyata.
const testOk = 'REASONING: jalankan test\nACTION: bash\nCOMMAND: echo "1 pass, 0 fail"\nSUMMARY: test dijalankan';

const askApproval = async () => ({ approved: true, condition: null });
const noop = () => {};

try {
  const CWD = process.cwd();

  // ── [1] Klaim done tanpa kerja apa pun HARUS ditolak ─────────────────────
  console.log('\n[1] done tanpa bukti ditolak oleh gerbang kontrak');
  {
    const { server, count } = await makeServer([doneOnly, mkdirOk, writeOk, doneAfter]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    const out = await runTask(
      'Bikin file src/app.js berisi kode sederhana',
      null, [], null, { tasks: 0, actions: 0 }, noop, noop,
      () => false, askApproval, null
    );
    server.close();

    check('done pertama DITOLAK — loop lanjut ke aksi nyata', count() > 1, `panggilan provider=${count()}`);
    check('file benar-benar dibuat lewat aksi write', fs.existsSync(path.join(CWD, 'src/app.js')));
    check('task berakhir dengan laporan berisi bukti',
      typeof out === 'string' && /dibuktikan|bukti/i.test(out), JSON.stringify(out && out.slice(0, 120)));
    try { fs.rmSync(path.join(CWD, 'src/app.js'), { force: true }); } catch {}
  }

  // ── [2] Model keras kepala: done terus tanpa bukti ───────────────────────
  console.log('\n[2] model keras kepala: done terus tanpa bukti');
  {
    const { server, count } = await makeServer([doneOnly]);   // SELALU done
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    const out = await runTask(
      'Bikin file penting.js',
      null, [], null, { tasks: 0, actions: 0 }, noop, noop,
      () => false, askApproval, null
    );
    server.close();

    check('loop berhenti (tidak menggantung selamanya)', count() > 0);
    check('hasil BUKAN klaim sukses — melainkan laporan belum selesai',
      typeof out === 'string' && /BELUM selesai/i.test(out), JSON.stringify(out && out.slice(0, 160)));
    check('laporan menyebut kriteria yang belum terbukti',
      typeof out === 'string' && /Kriteria belum terbukti/i.test(out));
    check('tidak ada file penting.js yang diklaim dibuat',
      !fs.existsSync(path.join(CWD, 'penting.js')));
  }

  // ── [3] Kontrak benar-benar dikirim ke model ─────────────────────────────
  console.log('\n[3] kontrak task disuntik ke prompt model');
  {
    const { server, seen } = await makeServer([mkdirOk, writeOk, doneAfter]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    await runTask(
      'Bikin file src/app.js berisi kode sederhana',
      null, [], null, { tasks: 0, actions: 0 }, noop, noop,
      () => false, askApproval, null
    );
    server.close();
    try { fs.rmSync(path.join(CWD, 'src/app.js'), { force: true }); } catch {}

    const payload = seen.join('\n');
    check('prompt memuat blok KONTRAK TASK', /KONTRAK TASK/.test(payload));
    check('prompt memuat acceptance criteria', /ACCEPTANCE CRITERIA/.test(payload));
    check('prompt menyebut done butuh bukti', /done.*bukti|bukti.*done/i.test(payload));
  }
} catch (err) {
  fail++;
  console.log(`  ✗ EXCEPTION: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : err}`);
} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
}

console.log(`\n=== HASIL CONTRACT-GATE INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
