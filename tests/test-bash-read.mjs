// tests/test-bash-read.mjs — Kontrak guard output bash + read berjendela.
//
// Dua bug nyata yang ditutup di sini:
//
// 1) bash maxBuffer. Default Node 1MB. Command yang outputnya lebih besar
//    BAKAL gagal dengan ERR_CHILD_PROCESS_STDIO_MAXBUFFER — pesan errornya
//    gak jelas, agent gak tau kenapa, dan yang paling parah: agent bisa
//    nyimpulin command-nya gagal padahal cuma outputnya kegedean.
//    Jebakan kedua (ketangkep test ini): jalur SUKSES gak ikut dipotong,
//    jadi stdout 2MB lolos utuh ke LLM.
//
// 2) read tanpa offset. File >2000 karakter dipotong "[...TRUNCATED]" dan
//    TIDAK ADA cara baca sisanya. Bug di baris 500 = invisible selamanya.
//
// CATATAN: file uji DIBUAT DI DALAM cwd (repo), bukan /tmp — isSafePath
// cuma ngebolehin path di bawah cwd. Pakai /tmp bikin semua tes read gagal
// karena ACCESS DENIED, dan itu bikin tesnya sendiri yang salah.
//
// Written by K-sRouter

import fs from 'fs';
import path from 'path';
import { runCommand } from '../src/bash.js';
import { readFileRange } from '../src/utils/fs.js';
import { planStep } from '../src/plan.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

// Di dalam cwd — biar lolos isSafePath.
const tmp = fs.mkdtempSync(path.join(process.cwd(), '.tmp-test-bashread-'));
const bigFile = path.join(tmp, 'big.txt');
const lines = Array.from({ length: 1000 }, (_, i) => `baris-${i + 1}`);
fs.writeFileSync(bigFile, lines.join('\n'));

(async () => {
  // ── [1] bash: output biasa tetap jalan ──
  console.log('\n[1] bash — output normal');
  const ok = await runCommand('echo halo');
  check('command sukses → ok:true', ok.ok === true);
  check('stdout terbaca', ok.stdout === 'halo', JSON.stringify(ok.stdout));
  check('exit code 0', ok.code === 0);

  // ── [2] bash: output > 1MB (regresi utama) ──
  console.log('\n[2] bash — output melebihi maxBuffer lama (1MB)');
  const big = await runCommand(`head -c 2000000 /dev/zero | tr '\\0' 'a'`);
  check('output 2MB → TIDAK gagal karena buffer', big.buffered !== true,
    big.buffered ? 'masih kena maxBuffer' : '');
  check('output 2MB → command dianggap sukses', big.ok === true, `ok=${big.ok} code=${big.code}`);
  check('stdout jalur SUKSES tetap dipotong', big.stdout.includes('TRUNCATED'),
    `len=${big.stdout.length} cut=${big.truncated}`);
  check('stdout di bawah 25k', big.stdout.length < 25000, `len=${big.stdout.length}`);
  check('ditandai truncated:true', big.truncated === true);

  // ── [3] bash: error nyata tetap kelihatan sebagai error ──
  console.log('\n[3] bash — command gagal beneran');
  const bad = await runCommand('exit 3');
  check('exit != 0 → ok:false', bad.ok === false);
  check('exit code diteruskan (3)', Number(bad.code) === 3, `code=${bad.code}`);

  const noCmd = await runCommand('perintah_yang_gak_ada_xyz123');
  check('command tak dikenal → ok:false', noCmd.ok === false);
  check('stderr ada isinya', noCmd.stderr.length > 0);

  // ── [4] bash: timeout (env dibaca per-panggilan) ──
  console.log('\n[4] bash — timeout');
  process.env.K_SROUTER_BASH_TIMEOUT_MS = '1200';
  const slow = await runCommand('sleep 6');
  check('command kelamaan → ok:false', slow.ok === false, `ok=${slow.ok}`);
  check('ditandai timedOut', slow.timedOut === true, `timedOut=${slow.timedOut}`);
  check('stderr jelasin soal waktu', /waktu/i.test(slow.stderr), JSON.stringify(slow.stderr).slice(0, 90));
  delete process.env.K_SROUTER_BASH_TIMEOUT_MS;

  // ── [5] read range: jendela baris ──
  console.log('\n[5] read — jendela baris');
  const r1 = readFileRange(bigFile, 1, 10);
  check('ok:true', r1.ok === true, r1.content.slice(0, 60));
  check('totalLines = 1000', r1.totalLines === 1000, `${r1.totalLines}`);
  check('start=1 end=10', r1.start === 1 && r1.end === 10, `${r1.start}-${r1.end}`);
  check('ada nomor baris', /^\s*1\|baris-1$/m.test(r1.content), JSON.stringify(r1.content.split('\n')[0]));
  check('kasih tau sisa baris', r1.content.includes('ADA 990 BARIS LAGI'), 'petunjuk lanjutan gak ada');
  check('ada cara lanjut (offset=)', r1.content.includes('offset=11'));

  const r2 = readFileRange(bigFile, 500, 10);
  check('offset di tengah → baris 500-509', r2.start === 500 && r2.end === 509, `${r2.start}-${r2.end}`);
  check('isi baris 500 bener', r2.content.includes('baris-500') && r2.content.includes('baris-509'));

  const r3 = readFileRange(bigFile, 995, 50);
  check('offset dekat akhir → end ditutup di totalLines', r3.end === 1000, `${r3.end}`);
  check('halaman terakhir TIDAK bilang ada sisa', !r3.content.includes('BARIS LAGI'));

  // ── [6] read range: input ngaco jangan crash ──
  console.log('\n[6] read — input ngaco');
  const rNeg = readFileRange(bigFile, -5, -10);
  check('offset/limit negatif → tetap valid', rNeg.ok === true && rNeg.start === 1, `${rNeg.start}-${rNeg.end}`);
  const rZero = readFileRange(bigFile, 0, 0);
  check('offset 0 → dinormalkan', rZero.ok === true && rZero.start === 1);
  const rHuge = readFileRange(bigFile, 1, 999999);
  check('limit kegedean → dibatasi', rHuge.end <= 1000, `${rHuge.end}`);

  // ── [7] read range: kasus gagal ──
  console.log('\n[7] read — file gak ada / direktori / path sensitif');
  const rMissing = readFileRange(path.join(tmp, 'gak-ada.txt'));
  check('file gak ada → ok:false', rMissing.ok === false);
  check('error = not_found', rMissing.error === 'not_found');
  const rDir = readFileRange(tmp);
  check('direktori → ok:false', rDir.ok === false);
  check('arahin ke list_dir', rDir.content.includes('list_dir'));
  // Jalur yang emang HARUS diblokir — verifikasi guard-nya masih hidup.
  const rEnv = readFileRange(path.join(process.cwd(), '.env'));
  check('.env tetap DIBLOKIR', rEnv.ok === false && rEnv.error === 'blocked', `err=${rEnv.error}`);

  // ── [8] read range: cocok dengan potongan manual (regresi truncate) ──
  console.log('\n[8] read — verifikasi vs baca manual');
  const manual = fs.readFileSync(bigFile, 'utf8').split('\n');
  const r = readFileRange(bigFile, 250, 5);
  const expected = manual.slice(249, 254).join('\n');
  const stripped = r.content.split('\n').slice(0, 5).map(l => l.replace(/^\s*\d+\|/, '')).join('\n');
  check('isi baris identik dengan baca manual', stripped === expected,
    `\n      got: ${JSON.stringify(stripped.slice(0, 60))}\n      exp: ${JSON.stringify(expected.slice(0, 60))}`);

  // ── [8b] parser plan.js: OFFSET/LIMIT dari respons LLM ──
  // Kalau bagian ini bocor, model bisa minta LIMIT: -5 dan agent baca 1 baris
  // tanpa ada yang sadar. Nilai ngaco HARUS dibuang, bukan dipaksa jadi angka.
  console.log('\n[8b] parseStep — OFFSET/LIMIT dari model');
  const mock = (body) => async () => body;
  const ctx = { instruction: 'cek', fileSnapshot: '', history: [], agentMd: '',
    recentMemory: '', availableTools: [], webSearchCount: 0 };
  const s1 = await planStep(mock('REASONING: cek\nACTION: read\nTARGET: a.js\nOFFSET: 100\nLIMIT: 25'), ctx);
  check('offset+limit valid diteruskan', s1.offset === 100 && s1.limit === 25, `${s1.offset}/${s1.limit}`);
  const s2 = await planStep(mock('REASONING: baca\nACTION: read\nTARGET: a.js'), ctx);
  check('tanpa OFFSET/LIMIT → field absen', s2.offset === undefined && s2.limit === undefined);
  const s3 = await planStep(mock('REASONING: ngaco\nACTION: read\nTARGET: a.js\nOFFSET: abc\nLIMIT: -5'), ctx);
  check('nilai ngaco dibuang, bukan jadi 1', s3.offset === undefined && s3.limit === undefined,
    `${s3.offset}/${s3.limit}`);
  const s4 = await planStep(mock('REASONING: nol\nACTION: read\nTARGET: a.js\nOFFSET: 0\nLIMIT: 0'), ctx);
  check('0 dibuang (biar default kepakai)', s4.offset === undefined && s4.limit === undefined);
  const s5 = await planStep(mock('REASONING: besar\nACTION: read\nTARGET: a.js\nLIMIT: 999999'), ctx);
  check('limit kegedean → dibatasi 2000', s5.limit === 2000, `${s5.limit}`);
  const s6 = await planStep(mock('REASONING: ls\nACTION: list_dir\nTARGET: src'), ctx);
  check('action non-read gak kena tambahan field', s6.action === 'list_dir' && s6.limit === undefined);

  // ── [9] inti keluhan awal: file gede, bagian 2000+ char masih kebaca ──
  console.log('\n[9] regresi — bagian file di atas 2000 karakter');
  const part = readFileRange(bigFile, 800, 20);
  check('baris 800 (jauh di atas 2000 char) kebaca', part.content.includes('baris-800'), 'masih buta');
  check('tidak ada penanda TRUNCATED di output range', !part.content.includes('[...TRUNCATED]'));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n=== HASIL BASH+READ: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
