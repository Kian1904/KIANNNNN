// tests/test-bugfixes.mjs — Verifikasi fix 3 bug FINDING + handler edit balik:
//   1. Handler ACTION: edit EKSEKUSI (dipulihkan dari commit bff2c6a)
//   2. Snapshot utk file baru (is_new_file=1) + file lama (content=isi lama)
//   3. logStep legacy shape {task} + threadId=null gak crash
//   4. Guard isSafePath ngeblokir tulis ke path terlarang
// Jalur asli: runTask + mock provider lokal, backup/restore .settings.json.
// Written by K'

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');
const CWD = process.cwd();

const { runTask } = await import('../src/run-task.js');
const db = await import('../src/db.js');
const { showDiff } = await import('../src/diff.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l + (x ? ' — ' + x : '')));

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

const editStep = (target, body) =>
  `REASONING: tulis file\nACTION: edit\nTARGET: ${target}\n===CONTENT_START===\n${body}\n===CONTENT_END===`;
const doneStep = (s = 'selesai') => `REASONING: selesai\nACTION: done\nSUMMARY: ${s}`;

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : null;
const approve = async () => ({ approved: true, condition: null });
const deny = async () => ({ approved: false, condition: null });

const F_NEW = path.join(ROOT, 'tests/tmp-baru.txt');        // file baru
const F_OLD = path.join(ROOT, 'tests/tmp-lama.txt');        // file lama
const F_ENV = path.join(ROOT, '.env');                      // path terblokir

async function run(replies, askApproval = approve) {
  const srv = await makeServer(replies);
  fs.writeFileSync(SETTINGS, JSON.stringify(
    [{ name: 'mock', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 't', model: 'm', active: true }]
  ));
  try {
    return await runTask('tugas edit', null, [], TID, null, null, null, () => false, askApproval, null);
  } finally { srv.close(); }
}

const TID = db.createThread();

try {
  // ── 1. File BARU dibuat via ACTION: edit ──
  console.log('\n[1] handler edit: file baru');
  await run([editStep(F_NEW, 'isi file baru v1'), doneStep()]);
  check('file kebuat di disk', fs.existsSync(F_NEW) && fs.readFileSync(F_NEW, 'utf8').includes('isi file baru v1'));
  const snapNew = db.getLatestSnapshot(F_NEW);
  check('snapshot ADA (dulu: gak pernah ke-save)', !!snapNew);
  check('snapshot ditandai is_new_file=1', snapNew && snapNew.is_new_file === 1, `got ${snapNew?.is_new_file}`);
  check('content snapshot file baru = kosong', snapNew && snapNew.content === '');

  // ── 2. File LAMA diedit → snapshot berisi isi lama ──
  console.log('\n[2] handler edit: file lama');
  fs.writeFileSync(F_OLD, 'KONTEN LAMA SEBELUM EDIT');
  await run([editStep(F_OLD, 'KONTEN BARU SESUDAH EDIT'), doneStep()]);
  const snapOld = db.getLatestSnapshot(F_OLD);
  check('isi file berubah', fs.readFileSync(F_OLD, 'utf8').includes('KONTEN BARU SESUDAH EDIT'));
  check('snapshot berisi isi LAMA', snapOld && snapOld.content === 'KONTEN LAMA SEBELUM EDIT', JSON.stringify(snapOld?.content));
  check('is_new_file=0 utk file lama', snapOld && snapOld.is_new_file === 0);

  // ── 3. Path terblokir: edit .env DITOLAK, file gak tersentuh ──
  console.log('\n[3] guard isSafePath');
  const envBefore = fs.existsSync(F_ENV) ? fs.readFileSync(F_ENV, 'utf8') : null;
  await run([editStep('.env', 'KECURANGAN=1'), editStep('.env', 'KECURANGAN=2'), editStep('.env', 'KECURANGAN=3'), doneStep('hentikan')]);
  const envAfter = fs.existsSync(F_ENV) ? fs.readFileSync(F_ENV, 'utf8') : null;
  check('.env gak berubah sama sekali', envBefore === envAfter);
  check('gak ada snapshot utk path terblokir', !db.getLatestSnapshot('.env'));

  // ── 4. Approval DITOLAK → file gak ditulis ──
  console.log('\n[4] approval ditolak');
  const out = await run([editStep(F_OLD, 'NGACO GAK DIIZINKAN'), doneStep()], deny);
  check('task berhenti + file gak diubah', String(out).includes('dibatalkan') && fs.readFileSync(F_OLD, 'utf8').includes('KONTEN BARU SESUDAH EDIT'));

  // ── 5. logStep legacy shape gak crash ──
  console.log('\n[5] logStep defensive');
  let r = null, err = null;
  try { r = db.logStep({ task: 'legacy tanpa thread', actionType: 'done', approved: true }); }
  catch (e) { err = e; }
  check('shape {task} + threadId=null: gak crash', err === null, err?.message);
  check('...dan skip dgn return null', r === null);
  r = db.logStep({ task: 'legacy dgn thread', actionType: 'done', threadId: TID });
  check('shape {task} + threadId: insert OK', r !== null && (r.changes ?? 1) >= 0);
  const conv = db.getConversation(TID, 50);
  check('content ternormalisasi dari task', conv.some(c => c.content === 'legacy dgn thread'));

  // ── 6. diff utk preview edit (gaya unified) ──
  console.log('\n[6] showDiff gaya unified');
  const d = showDiff('a\nb\nc', 'a\nBARU\nc');
  check('header @@ ada', /^@@ -\d+,\d+ \+\d+,\d+ @@$/m.test(d));

} finally {
  if (real !== null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  for (const f of [F_NEW, F_OLD]) if (fs.existsSync(f)) fs.unlinkSync(f);
  try { db.deleteThread(TID); } catch {}
}

console.log(`\n=== HASIL FIX-3-BUG: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
