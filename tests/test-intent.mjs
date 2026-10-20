// tests/test-intent.mjs — Kontrak classifier intent (casual / task / hybrid).
//
// Yang sebenernya diuji di sini bukan cuma "tebakan bener apa enggak", tapi
// juga: BERAPA BANYAK panggilan LLM yang dihemat. Dulu tiap input = 1 LLM call.
// Sekarang heuristik harus jawab mayoritas, dan LLM cuma buat yang RAGU.
//
// Kasus jebakan yang wajib lolos:
//   - "aku tadi mimpi aneh..."  → casual. Kata "tadi" BUKAN minta info terkini.
//   - "sekarang aku bingung"    → casual. "sekarang" di cerita, bukan cari data.
//   - "tolong jelasin kenapa error lalu perbaiki" → hybrid, BUKAN task.
//     Urutan cek penting: TASK_VERBS duluan bakal nelen sinyal "kenapa".
//   - ragu → casual, BUKAN task. Salah ke task = mahal (agent otonom jalan).
//
// Written by K-sRouter

import { classifyIntent, classifyIntentHeuristic } from '../src/intent.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

// ── [1] Heuristik: label benar ──
console.log('\n[1] classifyIntentHeuristic — label');

const LABELED = [
  ['halo kaccan', 'casual'],
  ['makasih', 'casual'],
  ['apa itu debounce', 'casual'],
  ['jelasin cara kerja async await', 'casual'],
  ['pesan tiket kereta', 'casual'],
  ['kamu bisa apa aja?', 'casual'],
  ['versi terbaru node', 'task'],
  ['harga bitcoin sekarang', 'task'],
  ['cari tau rilis terbaru next.js', 'task'],
  ['buat file test.js', 'task'],
  ['fix typo di src/app.js', 'task'],
  ['install express', 'task'],
  ['refactor src/repl.js', 'task'],
  ['baca src/ui.js terus ringkas', 'task'],
  ['halo, bisa baca file src/a.js?', 'task'],
  ['apa itu debounce lalu bikin implementasinya', 'hybrid'],
  ['tolong jelasin kenapa kode ini error lalu perbaiki', 'hybrid'],
];

let mismatch = [];
for (const [text, expected] of LABELED) {
  const got = classifyIntentHeuristic(text).intent;
  if (got !== expected) mismatch.push(`${JSON.stringify(text)} → ${got} (harusnya ${expected})`);
}
check(`label cocok ${LABELED.length}/${LABELED.length}`, mismatch.length === 0, mismatch.join(' | '));

// ── [2] Jebakan kata waktu ──
console.log('\n[2] Jebakan kata waktu (regresi: "tadi" bikin cerita jadi task)');

const CERITA = [
  'aku tadi mimpi aneh banget soal sekolah dan temen temen ku',
  'sekarang aku bingung mau ngapain',
  'bagaimana perasaan mu sekarang',
  'tadi aku ketemu guru di jalan',
];
let ceritaKeTask = CERITA.filter(t => classifyIntentHeuristic(t).intent === 'task');
check(`cerita pribadi → BUKAN task (0 dari ${CERITA.length})`, ceritaKeTask.length === 0, ceritaKeTask.join(' | '));

// Tapi yang BENERAN minta data terkini harus tetap task.
const DATA = [
  'harga bitcoin sekarang',
  'berapa harga bensin hari ini',
  'cek skor pertandingan tadi',
];
let dataKeCasual = DATA.filter(t => classifyIntentHeuristic(t).intent !== 'task');
check(`minta data terkini → task (0 luput dari ${DATA.length})`, dataKeCasual.length === 0, dataKeCasual.join(' | '));

// ── [3] Ragu → casual, bukan task ──
console.log('\n[3] Fail-direction: ragu harus jatuh ke casual');
const raguTexts = [
  'aku tadi mimpi aneh banget soal sekolah dan temen temen ku semua yang udah lama',
  'analisis performa query database ini',
];
let raguKeTask = raguTexts.filter(t => {
  const r = classifyIntentHeuristic(t);
  return !r.confident && r.intent === 'task';
});
check('ragu → intent casual (bukan task)', raguKeTask.length === 0, raguKeTask.join(' | '));

// ── [4] Hemat LLM: mayoritas input gak boleh manggil LLM ──
console.log('\n[4] classifyIntent — penghematan panggilan LLM');

let llmCalls = 0;
const spy = async () => { llmCalls++; return 'task'; };

const banyak = [
  'halo kaccan', 'makasih', 'apa itu closure', 'jelasin async await',
  'versi terbaru node', 'harga bitcoin sekarang', 'buat file test.js',
  'fix typo di src/app.js', 'install express', 'refactor src/repl.js',
  'baca src/ui.js terus ringkas', 'apa itu debounce lalu bikin implementasinya',
  'pesan tiket kereta', 'kamu bisa apa aja?',
];
(async () => {
  for (const t of banyak) await classifyIntent(t, spy);
  const persen = Math.round((1 - llmCalls / banyak.length) * 100);
  check(`LLM cuma dipanggil <=25% (${llmCalls}/${banyak.length}, hemat ${persen}%)`,
    llmCalls <= Math.ceil(banyak.length * 0.25), `${llmCalls} panggilan`);

  // Input ragu HARUS manggil LLM (biar keputusan bagus).
  const before = llmCalls;
  const hasil = await classifyIntent('aku tadi mimpi aneh banget soal sekolah dan temen temen ku semua', spy);
  check('input ragu memanggil LLM', llmCalls === before + 1, `delta ${llmCalls - before}`);
  check('jawaban LLM dipakai saat ragu', hasil === 'task', `dapat ${hasil}`);

  // LLM error → jangan block user, jatuh ke heuristik.
  const afterErr = llmCalls;
  const hasilErr = await classifyIntent('aku tadi mimpi aneh banget soal sekolah dan temen temen ku semua',
    async () => { llmCalls++; throw new Error('provider down'); });
  check('LLM error → tetap balik nilai (tidak throw)', typeof hasilErr === 'string' && hasilErr.length > 0, `dapat ${hasilErr}`);
  check('LLM error → pakai heuristik (casual)', hasilErr === 'casual', `dapat ${hasilErr}`);

  // Jawaban model ngaco → jatuh ke heuristik, bukan diteruskan.
  const hasilNgaco = await classifyIntent('aku tadi mimpi aneh banget soal sekolah dan temen temen ku semua',
    async () => 'ENTAHLAH SAYA BINGUNG');
  check('jawaban LLM ngaco → pakai heuristik', hasilNgaco === 'casual', `dapat ${hasilNgaco}`);

  // Tanpa askFn sama sekali → gak boleh crash.
  const hasilNoFn = await classifyIntent('buat file test.js');
  check('tanpa askFn → jalan (task)', hasilNoFn === 'task', `dapat ${hasilNoFn}`);

  console.log(`\n=== HASIL INTENT: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
