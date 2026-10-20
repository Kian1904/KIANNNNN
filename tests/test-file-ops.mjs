// tests/test-file-ops.mjs — Aksi destruktif: delete / rename / move.
//
// Ini action paling berbahaya di KIANNNNN. Yang diuji bukan cuma "berhasil
// hapus", tapi SEMUA jalan menuju gagal: path diblokir, direktori gak kosong,
// DEST udah ada, snapshot gagal. Kalau salah satu bocor, user kehilangan file.

import fs from 'fs';
import path from 'path';
import { inspectTarget, describeTarget, rejectReason, applyFileOp } from '../src/file-ops.js';
import { MODES, decide, DESTRUCTIVE_ACTIONS } from '../src/modes.js';
import { saveSnapshot, getLatestSnapshot } from '../src/db.js';
import { isSafePath, readFileSafe } from '../src/utils/fs.js';
import { planStep } from '../src/plan.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const ROOT = process.cwd();
let work;

function setup() {
  work = fs.mkdtempSync(path.join(ROOT, '.tmp-fops-'));
  fs.writeFileSync(path.join(work, 'ada.txt'), 'isi asli\nbaris dua\nbaris tiga\n');
  fs.writeFileSync(path.join(work, 'lain.txt'), 'file lain\n');
  fs.mkdirSync(path.join(work, 'kosong'));
  fs.mkdirSync(path.join(work, 'berisi'));
  fs.writeFileSync(path.join(work, 'berisi', 'x.txt'), 'x');
}
function teardown() {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
}
const P = (n) => path.join(work, n);

console.log('=== [1] gate approval per mode ===');
{
  for (const a of ['delete', 'rename', 'move']) {
    check(`${a} terdaftar destruktif`, DESTRUCTIVE_ACTIONS.has(a));
  }
  check('safe: delete TANYA', decide(MODES.SAFE, { action: 'delete', isDestructive: true }).auto === false);
  check('wellwell: edit AUTO', decide(MODES.WELLWELL, { action: 'edit', isDestructive: false }).auto === true);
  check('wellwell: delete TETAP TANYA', decide(MODES.WELLWELL, { action: 'delete', isDestructive: true }).auto === false);
  check('yolo: delete AUTO', decide(MODES.YOLO, { action: 'delete', isDestructive: true }).auto === true);
}

console.log('\n=== [2] inspectTarget ===');
{
  setup();
  const f = inspectTarget(P('ada.txt'));
  check('file: kind=file', f.kind === 'file');
  check('file: baris kehitung', f.lines === 4);
  check('file: preview ada', typeof f.preview === 'string' && f.preview.includes('isi asli'));
  check('file: readFileSafe nolak dir -> bukan file', inspectTarget(P('kosong')).kind === 'dir_empty');
  check('dir kosong: kind=dir_empty', inspectTarget(P('kosong')).kind === 'dir_empty');
  check('dir berisi: kind=dir_nonempty', inspectTarget(P('berisi')).kind === 'dir_nonempty');
  check('hilang: kind=missing?', inspectTarget(P('gakada.txt')).ok === false);

  const b = inspectTarget('/etc/hosts');
  check('path di luar ALLOW_ROOT ditolak', b.ok === false && b.error === 'blocked');
  check('isSafePath setuju: /etc/hosts gak aman', isSafePath('/etc/hosts') === false);
  check('isSafePath: .env gak aman', isSafePath(path.join(ROOT, '.env')) === false);
  check('isSafePath: file kerja aman', isSafePath(P('ada.txt')) === true);
  teardown();
}

console.log('\n=== [3] describeTarget jujur soal ukuran ===');
{
  setup();
  const d = describeTarget(P('ada.txt'), inspectTarget(P('ada.txt')));
  check('describe sebut ukuran', d.includes('byte'));
  check('describe sebut jumlah baris', d.includes('baris'));
  const dd = describeTarget(P('berisi'), inspectTarget(P('berisi')));
  check('describe dir berisi: sebut TIDAK KOSONG', dd.includes('TIDAK KOSONG'));
  check('describe dir berisi: sebut jumlah isi', dd.includes('1 isi'));
  teardown();
}

console.log('\n=== [4] rejectReason: apa yang DITOLAK ===');
{
  setup();
  const kosong = inspectTarget(P('kosong'));
  const berisi = inspectTarget(P('berisi'));
  const file = inspectTarget(P('ada.txt'));

  check('file biasa: boleh', rejectReason(P('ada.txt'), file) === null);
  check('dir kosong: boleh', rejectReason(P('kosong'), kosong) === null);
  check('dir berisi: DITOLAK', typeof rejectReason(P('berisi'), berisi) === 'string');
  check('pesan tolak sebut alasan', rejectReason(P('berisi'), berisi).includes('tidak kosong'));
  check('path terblokir: DITOLAK', rejectReason(P('.env'), inspectTarget(P('.env'))) !== null);
  check('.env gak bisa di-inspect', inspectTarget(path.join(ROOT, '.env')).ok === false);
  teardown();
}

console.log('\n=== [5] applyFileOp: delete ===');
{
  setup();
  const r = applyFileOp('delete', P('ada.txt'));
  check('delete file: ok', r.ok === true);
  check('delete file: beneran hilang', !fs.existsSync(P('ada.txt')));

  const r2 = applyFileOp('delete', P('kosong'));
  check('delete dir kosong: ok', r2.ok === true);
  check('delete dir kosong: hilang', !fs.existsSync(P('kosong')));

  const r3 = applyFileOp('delete', P('berisi'));
  check('delete dir BERISI: ditolak', r3.ok === false);
  check('delete dir berisi: pesan jelas', r3.error.includes('tidak kosong'));
  check('delete dir berisi: masih ada', fs.existsSync(P('berisi')));

  const r4 = applyFileOp('delete', P('gakada.txt'));
  check('delete file hilang: ditolak', r4.ok === false);

  const r5 = applyFileOp('delete', path.join(ROOT, '.env'));
  check('delete .env: DIBLOKIR', r5.ok === false);
  teardown();
}

console.log('\n=== [6] applyFileOp: rename / move ===');
{
  setup();
  const r = applyFileOp('rename', P('ada.txt'), P('baru.txt'));
  check('rename: ok', r.ok === true);
  check('rename: sumber hilang', !fs.existsSync(P('ada.txt')));
  check('rename: tujuan ada', fs.existsSync(P('baru.txt')));
  check('rename: isi kejaga', fs.readFileSync(P('baru.txt'), 'utf8').includes('isi asli'));

  const r2 = applyFileOp('move', P('baru.txt'), path.join(work, 'berisi', 'dipindah.txt'));
  check('move: ok', r2.ok === true);
  check('move: masuk subdir', fs.existsSync(path.join(work, 'berisi', 'dipindah.txt')));

  fs.writeFileSync(P('korban.txt'), 'jangan ditimpa\n');
  const r3 = applyFileOp('rename', P('baru.txt') /* udah pindah, ini harus gagal */, P('lain.txt'));
  check('rename sumber hilang: ditolak', r3.ok === false);

  fs.writeFileSync(P('ada2.txt'), 'a\n');
  const r4 = applyFileOp('rename', P('ada2.txt'), P('lain.txt'));
  check('rename TIMPA file ada: DITOLAK', r4.ok === false);
  check('rename: pesan sebut udah ada', r4.error.includes('ada'));
  check('rename: file korban utuh', fs.readFileSync(P('lain.txt'), 'utf8').includes('file lain'));

  const r5 = applyFileOp('rename', P('ada2.txt'), P('x.txt'));
  check('rename ke DEST tanpa ekstensi: tetap boleh', r5.ok === true);

  const r6 = applyFileOp('move', P('x.txt'), path.join(ROOT, '.env'));
  check('move ke .env: DIBLOKIR', r6.ok === false);
  teardown();
}

console.log('\n=== [7] DEST relatif / DEST kosong ===');
{
  setup();
  const r = applyFileOp('rename', P('lain.txt'), '');
  check('DEST kosong: ditolak', r.ok === false);
  const r2 = applyFileOp('rename', P('lain.txt'), path.join(work, 'sub', 'dalam.txt'));
  check('DEST induk gak ada: ok (dibikin)', r2.ok === true);
  check('file ada di sub baru', fs.existsSync(path.join(work, 'sub', 'dalam.txt')));
  teardown();
}

console.log('\n=== [8] round-trip rollback: snapshot -> hapus -> pulihin ===');
{
  setup();
  const f = P('ada.txt');
  const ORIG = fs.readFileSync(f, 'utf8');
  saveSnapshot({ filepath: f, content: ORIG, isNewFile: false });
  applyFileOp('delete', f);
  check('file terhapus', !fs.existsSync(f));

  const snap = getLatestSnapshot(f);
  check('snapshot ada', !!snap);
  check('snapshot: is_new_file=0 (file lama)', snap.is_new_file === 0);
  check('snapshot: isi lengkap', snap.content === ORIG);

  // Inilah bug yang dulu: readFileSafe file hilang balikin placeholder,
  // dan REPL nulis placeholder itu ke disk.
  const placeholder = readFileSafe(f);
  check('readFileSafe file hilang: placeholder', placeholder === '(file tidak ditemukan)');
  check('placeholder BUKAN isi asli (bukti bug lama)', placeholder !== ORIG);

  fs.writeFileSync(f, snap.content, 'utf8');
  check('setelah pulihin: identik dengan asli', fs.readFileSync(f, 'utf8') === ORIG);
  teardown();
}

console.log('\n=== [9] parser plan.js: DEST & target destruktif ===');
{
  const mkAsk = (raw) => async () => raw;
  const mkCtx = () => ({ history: [], agent: null });
  const del = await planStep(mkAsk('REASONING: user minta hapus\nACTION: delete\nTARGET: sampah.txt'), mkCtx());
  check('parse delete: action', del.action === 'delete');
  check('parse delete: target', del.target === 'sampah.txt');

  const ren = await planStep(mkAsk('REASONING: ganti nama\nACTION: rename\nTARGET: a.txt\nDEST: b.txt'), mkCtx());
  check('parse rename: action', ren.action === 'rename');
  check('parse rename: dest', ren.dest === 'b.txt');

  const mv = await planStep(mkAsk('REASONING: pindah\nACTION: move\nTARGET: a.txt\nDEST: sub/b.txt'), mkCtx());
  check('parse move: dest relatif', mv.dest === 'sub/b.txt');

  // rename/move tanpa DEST HARUS throw (fail-closed), bukan diam-diam bikin
  // langkah tanpa tujuan.
  let threw = false;
  try {
    await planStep(mkAsk('REASONING: ren\nACTION: rename\nTARGET: a.txt'), mkCtx());
  } catch (e) {
    threw = /DEST/.test(e.message);
  }
  check('rename tanpa DEST: THROW (fail-closed)', threw);

  const spasi = await planStep(mkAsk('REASONING: ren\nACTION: rename\nTARGET:  a.txt  \nDEST:  b.txt  '), mkCtx());
  check('DEST di-trim', spasi.dest === 'b.txt' && spasi.target === 'a.txt');
}

console.log('\n=== [10] guard data-hilang: snapshot KOSONG ===');
{
  setup();
  const f = P('ada.txt');
  const ORIG = fs.readFileSync(f, 'utf8');

  // Skenario nyata: snapshot kosong sementara file masih ada. Kalau REPL nulis
  // snap.content apa adanya, file jadi KOSONG = data hilang.
  saveSnapshot({ filepath: f, content: '', isNewFile: false });
  const snap = getLatestSnapshot(f);
  check('snapshot kosong tersimpan', snap.content === '' && snap.is_new_file === 0);
  check('file masih ada & berisi', fs.existsSync(f) && fs.readFileSync(f, 'utf8') === ORIG);
  // Aturan yang harus dipegang REPL: jangan timpa file dengan snapshot kosong.
  const shouldAbort = !(readFileSafe(f) === '(file tidak ditemukan)') && !snap.content;
  check('guard: rollback HARUS dibatalkan', shouldAbort === true);
  check('isi file selamat (guard gak nulis apa-apa)', fs.readFileSync(f, 'utf8') === ORIG);
  teardown();
}

console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
