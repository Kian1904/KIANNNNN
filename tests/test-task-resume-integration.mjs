// M49 integration: crash recovery BENERAN.
// Anak proses di-SIGKILL di tengah task, lalu task yang sama di-resume dari
// journal — dan resume tidak boleh mengulang kerja yang sudah terverifikasi.
// Written by K'

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m49-int-'));
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m49-work-'));

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

const { readJournal, replayJournal, isTerminalStatus, listTaskFiles } = await import('../src/task-journal.js');
const { planResume, isResumable, buildResumeInstruction } = await import('../src/task-resume.js');

function makeHangServer() {
  // Server ini sengaja: request pertama dijawab normal, request kedua dan
  // seterusnya DI-HANG tanpa response. Ini memaksa runTask macet di loop
  // retry sampai child di-SIGKILL dari luar.
  let callCount = 0;
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      callCount++;
      if (callCount === 1) {
        // Request pertama: jawab normal biar task mulai jalan.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'REASONING: mulai kerja\nACTION: bash\nCOMMAND: echo bukti-crash\nSUMMARY: langkah pertama jalan' } }] }));
      } else {
        // Request kedua+: hang selamanya. Jangan kirim response.
        // Ini yang bikin task stuck dan bisa di-crash dari luar.
      }
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;

try {
  const srv = await makeHangServer();
  fs.writeFileSync(SETTINGS, JSON.stringify([{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'x', model: 'm', active: true }]));

  // ── [1] Crash di tengah task, journal tetap valid ─────────────────────
  console.log('\n[1] crash di tengah task, journal tetap valid');
  {
    // PENTING: pakai path ABSOLUT ke index.js. cwd-nya folder temp, jadi
    // 'index.js' relatif akan dicari di folder temp dan gagal (MODULE_NOT_FOUND).
    const child = spawn(process.execPath, [path.join(ROOT, 'index.js')], {
      cwd: CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: TMP_HOME, K_STREAM: '0', K_NO_COLOR: '1' },
    });
    // Tunggu REPL siap (banner + readline)
    await new Promise(r => setTimeout(r, 2500));
    child.stdin.write('riset X lalu bikin kodenya\n');
    // Request #1 dijawab (agent mulai + journal dibuat), request #2 hang.
    // Tunggu lebih lama supaya runTask PASTI sudah jalan dan journal tertulis
    // sebelum SIGKILL. Kalau kill terlalu cepat, createJournal belum terpanggil.
    await new Promise(r => setTimeout(r, 9000));
    child.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 500));

    const files = listTaskFiles(path.join(TMP_HOME, '.kian_data', 'tasks'));
    check('journal: ada file setelah crash', files.length > 0, `found=${files.length}`);

    if (files.length > 0) {
      const entries = readJournal(files[0]);
      const state = replayJournal(entries);
      // Karena provider hang di request kedua, task TIDAK mungkin completed.
      // Status harusnya masih running atau undefined (belum sempat update).
      check('journal: task tidak berstatus completed setelah crash',
        !isTerminalStatus(state.status), `status=${state.status}`);
      check('journal: status masih bisa dilanjutkan',
        !isTerminalStatus(state.status), `status=${state.status}`);

      // ── [2] planResume membaca kondisi pasca-crash ───────────────────
      console.log('\n[2] planResume membaca kondisi pasca-crash');
      const plan = planResume(files[0]);
      check('resume: canResume true', plan.canResume === true, plan.reason);
      check('resume: goal terbaca dari journal', typeof plan.goal === 'string' && plan.goal.length > 0, plan.goal);
      check('resume: status bukan terminal', !isTerminalStatus(plan.status));

      const instr = buildResumeInstruction(plan);
      check('resume: instruksi memuat goal', instr.includes(plan.goal || 'riset'));
      check('resume: instruksi melarang mengulang dari nol', /jangan.*ulang|tidak perlu.*mengulangi/i.test(instr));
      check('resume: instruksi bukan kosong', instr.trim().length > 0);
    }
  }

  // ── [3] Task terminal menolak resume ─────────────────────────────────
  console.log('\n[3] task terminal menolak resume');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m49-term-'));
    const jPath = path.join(tmpDir, 'done.jsonl');
    fs.writeFileSync(jPath, [
      JSON.stringify({ type: 'task_start', taskId: 'done', goal: 'sudah beres', status: 'running', ts: Date.now() }),
      JSON.stringify({ type: 'action', action: 'bash', command: 'echo ok', verified: true, ts: Date.now() }),
      JSON.stringify({ type: 'status', status: 'completed', summary: 'kelar', ts: Date.now() }),
    ].join('\n') + '\n');

    check('terminal: isResumable false', isResumable(jPath) === false);
    const p = planResume(jPath);
    check('terminal: planResume canResume false', p.canResume === false);
    check('terminal: alasan dijelaskan', p.reason.length > 0);
    check('terminal: instruksi kosong', buildResumeInstruction(p) === '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  srv.close();
} catch (err) {
  fail++;
  console.log(`  ✗ EXCEPTION: ${err?.stack?.split('\n').slice(0, 4).join('\n') || err}`);
} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(CWD, { recursive: true, force: true }); } catch {}
}

console.log(`\n=== HASIL TASK-RESUME INTEGRASI: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
