// M48 integration: journal benar-benar ditulis lewat runTask ASLI.
// Membuktikan: action tercatat, status terminal tercatat, secret tidak bocor.
// Written by K'

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

// HOME isolasi SEBELUM import -> journal & db masuk tmp.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m48-int-'));
process.env.HOME = TMP_HOME;
process.env.K_STREAM = '0';

const { runTask } = await import('../src/run-task.js');
const { readJournal, replayJournal, listTaskFiles, defaultJournalDir } = await import('../src/task-journal.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

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

const mkdirOk = 'REASONING: siapkan\nACTION: bash\nCOMMAND: mkdir -p src && echo dibuat';
const writeOk = 'REASONING: tulis\nACTION: write\nTARGET: src/j.js\n===CONTENT_START===\nmodule.exports = 1;\n===CONTENT_END===';
const doneOk = 'REASONING: bukti ada\nACTION: done\nSUMMARY: File dibuat dan dibuktikan lewat pembacaan aktual.';
const doneOnly = 'REASONING: beres\nACTION: done\nSUMMARY: Semua sudah saya kerjakan.';

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const askApproval = async () => ({ approved: true, condition: null });
const noop = () => {};

try {
  const CWD = process.cwd();

  // ── [1] Task sukses -> journal berisi actions + status completed ─────────
  console.log('\n[1] journal mencatat aksi nyata dan status selesai');
  {
    const srv = await makeServer([mkdirOk, writeOk, doneOk]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    await runTask('Bikin file src/j.js berisi kode sederhana', null, [], null,
      { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null);
    srv.close();

    const files = listTaskFiles(defaultJournalDir());
    check('journal: file journal dibuat', files.length >= 1, `dapat ${files.length}`);

    const latest = files[files.length - 1];
    const entries = readJournal(latest);
    const state = replayJournal(entries);

    check('journal: ada entry task_start', entries.some(e => e.type === 'task_start'));
    check('journal: aksi write/bash tercatat', state.actions.length >= 2, `dapat ${state.actions.length}`);
    check('journal: aksi terverifikasi tercatat', state.verifiedCount >= 1);
    check('journal: ada entry acceptance', entries.some(e => e.type === 'acceptance'));
    check('journal: status akhir completed', state.status === 'completed', String(state.status));
    check('journal: goal tersimpan', /src\/j\.js/.test(state.goal));

    try { fs.rmSync(path.join(CWD, 'src/j.js'), { force: true }); } catch {}
  }

  // ── [2] Task gagal (loop limit) -> status failed, bukan completed ────────
  console.log('\n[2] journal mencatat kegagalan, bukan sukses palsu');
  {
    const srv = await makeServer([doneOnly]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    await runTask('Bikin file yang tidak akan pernah dibuat.js', null, [], null,
      { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null);
    srv.close();

    const files = listTaskFiles(defaultJournalDir());
    const latest = files[files.length - 1];
    const state = replayJournal(readJournal(latest));

    check('journal: status akhir failed saat loop limit', state.status === 'failed', String(state.status));
    check('journal: tidak ada entry acceptance palsu',
      !readJournal(latest).some(e => e.type === 'acceptance' && e.status === 'completed'));
  }

  // ── [3] Secret tidak pernah masuk journal ───────────────────────────────
  console.log('\n[3] secret tidak bocor ke journal');
  {
    const srv = await makeServer([
      'REASONING: cek env\nACTION: bash\nCOMMAND: echo API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 && echo done',
      doneOk,
    ]);
    fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

    await runTask('cek environment API_KEY', null, [], null,
      { tasks: 0, actions: 0 }, noop, noop, () => false, askApproval, null);
    srv.close();

    const files = listTaskFiles(defaultJournalDir());
    const raw = fs.readFileSync(files[files.length - 1], 'utf8');
    check('journal: sk- tidak ada di file', !/sk-[A-Za-z0-9]{20,}/.test(raw));
    check('journal: nama variabel tetap ada untuk audit', /API_KEY|REDACTED/.test(raw));
  }
} catch (err) {
  fail++;
  console.log(`  ✗ EXCEPTION: ${err?.stack?.split('\n').slice(0, 4).join('\n') || err}`);
} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
}

console.log(`\n=== HASIL TASK-JOURNAL INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
