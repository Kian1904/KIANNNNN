// tests/test-plan-review.mjs — Self-correct + review rencana + validasi makna.
//
// Yang diuji di sini SEMUA jalur gagal, bukan jalur senang:
//  - model balas sampah -> task GAK mati (dulu throw & matiin semua progress)
//  - gagal 2x lalu bener -> self-correct beneran, bukan cuma retry buta
//  - rencana valid secara bentuk tapi NGGAK MASUK AKAL -> ketangkep
//  - gerbang review: semua jawaban selain 'y' = TIDAK eksekusi (fail-closed)

import { planStep, planStepWithRetry, buildHistoryText } from '../src/plan.js';
import { validatePlan } from '../src/orchestrator.js';
import { formatPlan, reviewPlan, formatPlanForTelegram, MAX_REPLANS } from '../src/plan-review.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const CTX = { instruction: 'tes', fileSnapshot: '', history: [], agentMd: '', recentMemory: [], availableTools: [], webSearchCount: 0 };

// ---------- [1] planStepWithRetry: sampah gak boleh matiin loop ----------
console.log('\n[1] planStepWithRetry — balasan sampah tidak throw');

{
  let calls = 0;
  const sampah = async () => { calls++; return 'Oke siap! Aku bantu ya...'; };
  let threw = false;
  let res = null;
  try {
    res = await planStepWithRetry(sampah, CTX, { maxAttempts: 3 });
  } catch {
    threw = true;
  }
  check('tidak throw saat semua percobaan gagal', threw === false);
  check('balik ok:false (bukan exception)', res && res.ok === false);
  check('attempts = maxAttempts (3)', res && res.attempts === 3);
  check('LLM dipanggil tepat 3x', calls === 3);
  check('lastError diisi', !!res.lastError);
  check('raw mentah disimpan', res.raw === 'Oke siap! Aku bantu ya...');
}

// ---------- [2] self-correct: gagal dulu, baru bener ----------
console.log('\n[2] self-correct — gagal 2x lalu berhasil');

{
  let n = 0;
  let reminderDipercobaanTerakhir = false;
  const akhirnyaBener = async (sys) => {
    n++;
    if (n < 3) return 'Hmm aku belum paham...';
    reminderDipercobaanTerakhir = /GAGAL diparse/.test(String(sys)) && /TADI/.test(String(sys));
    return 'REASONING: user minta baca file\nACTION: read\nTARGET: src/repl.js';
  };
  const onRetryLog = [];
  const r = await planStepWithRetry(akhirnyaBener, CTX, {
    maxAttempts: 3,
    onRetry: (i, max, msg) => onRetryLog.push(`${i}/${max}:${msg.slice(0, 30)}`),
  });
  check('akhirnya ok:true', r.ok === true);
  check('attempts = 3', r.attempts === 3);
  check('step.action = read', r.step && r.step.action === 'read');
  check('step.target = src/repl.js', r.step && r.step.target === 'src/repl.js');
  check('percobaan terakhir dapat reminder + balasan sebelumnya', reminderDipercobaanTerakhir);
  check('onRetry dipanggil 2x (bukan di percobaan sukses)', onRetryLog.length === 2);
}

// ---------- [3] tanpa overhead kalau langsung bener ----------
console.log('\n[3] jalur normal — tidak ada overhead');

{
  let k = 0;
  const langsung = async () => { k++; return 'REASONING: selesai\nACTION: done\nSUMMARY: beres'; };
  const r = await planStepWithRetry(langsung, CTX, { maxAttempts: 3 });
  check('ok:true', r.ok === true);
  check('attempts = 1', r.attempts === 1);
  check('LLM dipanggil 1x saja', k === 1);
}

// ---------- [4] error nempel .raw (bukan regex dari pesan) ----------
console.log('\n[4] err.raw nempel di error');

{
  const sampah = async () => 'teks tanpa format apapun';
  const r = await planStepWithRetry(sampah, CTX, { maxAttempts: 1 });
  check('raw sama persis dengan balasan model', r.raw === 'teks tanpa format apapun');
}

// ---------- [5] planStep biasa MASIH throw (perilaku lama gak diubah) ----------
console.log('\n[5] planStep mentah tetap throw (kontrak lama utuh)');

{
  const sampah = async () => 'bukan format';
  let threw = false;
  try { await planStep(sampah, CTX); } catch { threw = true; }
  check('planStep langsung masih throw — dipakai internal', threw === true);
}

// ---------- [6] validatePlan: valid bentuk TAPI gak masuk akal ----------
console.log('\n[6] validatePlan — validasi makna');

{
  const T = (id, role, brief, dep = null) => ({ id, role, brief, dependsOn: dep });

  check('rencana waras -> 0 masalah',
    validatePlan({ tasks: [T(1, 'researcher', 'Riset cara kerja debounce dan kumpulkan faktanya'), T(2, 'coder', 'Implementasi debounce berdasar riset task 1', 1)] }).length === 0);

  const rEdit = validatePlan({ tasks: [T(1, 'researcher', 'Tulis dan ubah file src/ui.js jadi rapi')] });
  check('researcher disuruh ngubah file -> ketangkep', rEdit.length > 0);
  check('pesannya nyaranin pakai coder', rEdit.some(p => /coder/.test(p)));

  // REGRESI PENTING: validator yang kebanyakan ngamuk bikin squad gak pernah
  // kepake. Brief riset di bawah ini SAH — "implementasi" di situ objek, bukan
  // perintah. Ini bug nyata yang ketemu cuma gara-gara dijalanin di REPL asli.
  const risetSah = validatePlan({ tasks: [T(1, 'researcher', 'Riset cara kerja debounce di JavaScript. Jelaskan konsepnya, perbedaan dengan throttle, dan kumpulkan fakta teknis yang dibutuhkan untuk implementasi.')] });
  check('regresi: riset "kumpulkan fakta untuk implementasi" TIDAK dituduh ngubah file', risetSah.length === 0);
  check('regresi: kata benda "implementasi" di tengah kalimat aman', validatePlan({ tasks: [T(1, 'researcher', 'Kumpulkan bahan implementasi debounce dari dokumentasi resmi')] }).length === 0);

  check('researcher MULAI dengan "Implementasikan ..." -> ketangkep',
    validatePlan({ tasks: [T(1, 'researcher', 'Implementasikan fungsi debounce di src/x.js')] }).length > 0);
  check('researcher MULAI dengan "Hapus ..." -> ketangkep',
    validatePlan({ tasks: [T(1, 'researcher', 'Hapus file lama yang gak dipakai')] }).length > 0);

  check('coder disuruh web_search -> ketangkep',
    validatePlan({ tasks: [T(1, 'coder', 'Cari di web lalu tulis kodenya')] }).length > 0);
  check('coder MULAI dengan "Riset ..." -> ketangkep juga',
    validatePlan({ tasks: [T(1, 'coder', 'Riset cara kerja debounce di web lalu tulis kodenya')] }).length > 0);
  check('coder nulis kode (kata kerja di depan) -> LOLOS, bukan false positive',
    validatePlan({ tasks: [T(1, 'coder', 'Implementasikan fungsi debounce di src/debounce.js')] }).length === 0);

  check('brief kelewat pendek -> ketangkep',
    validatePlan({ tasks: [T(1, 'coder', 'benerin')] }).length > 0);

  check('brief wajar gak kena aturan panjang',
    validatePlan({ tasks: [T(1, 'coder', 'Perbaiki bug parser di src/plan.js')] }).length === 0);

  const rYatim = validatePlan({ tasks: [T(1, 'researcher', 'Riset topik A yang panjang dan lengkap', 2), T(2, 'coder', 'Tulis kode berdasar riset task satu', 1)] });
  check('semua dependsOn (gak ada yang bisa mulai) -> ketangkep', rYatim.length > 0);

  check('reviewer baca setelah coder nulis -> BUKAN masalah',
    validatePlan({ tasks: [T(1, 'coder', 'Ubah dan tulis ulang src/db.js'), T(2, 'reviewer', 'Periksa hasil perubahan src/db.js', 1)] }).length === 0);

  check('researcher baca setelah coder nulis -> ditandai',
    validatePlan({ tasks: [T(1, 'coder', 'Ubah dan tulis ulang src/db.js'), T(2, 'researcher', 'Baca file src/db.js setelah itu lalu rangkum', 1)] }).length > 0);
}

// ---------- [7] formatPlan: rencana nampil UTUH ----------
console.log('\n[7] formatPlan — semua task kelihatan');

{
  const tasks = [
    { id: 1, role: 'researcher', brief: 'Riset A', dependsOn: null },
    { id: 2, role: 'coder', brief: 'Kode B', dependsOn: 1 },
  ];
  const txt = formatPlan(tasks).join('\n');
  check('jumlah task disebut', /2 task/.test(txt));
  check('ada 2 wave', /Wave 1/.test(txt) && /Wave 2/.test(txt));
  check('brief task 1 muncul', /Riset A/.test(txt));
  check('brief task 2 muncul', /Kode B/.test(txt));
  check('ketergantungan disebut', /setelah task 1/.test(txt));
  check('aksi yang boleh disebut (whitelist role kelihatan)', /boleh:/.test(txt));

  // rencana yang gak bisa di-topo-sort harus JUJUR bilang bermasalah
  const siklus = formatPlan([
    { id: 1, role: 'coder', brief: 'A', dependsOn: 2 },
    { id: 2, role: 'coder', brief: 'B', dependsOn: 1 },
  ]).join('\n');
  check('siklus dependensi -> dinyatakan BERMASALAH, bukan didiemin', /BERMASALAH/.test(siklus));
}

// ---------- [8] reviewPlan: gerbang fail-closed ----------
console.log('\n[8] reviewPlan — semua jawaban selain y = TIDAK eksekusi');

{
  const tasks = [{ id: 1, role: 'coder', brief: 'Kode X', dependsOn: null }];
  const out = [];
  const io = (answer) => ({ print: (s) => out.push(s), ask: async () => answer });

  check("jawab 'y' -> execute", (await reviewPlan(tasks, io('y'))) === 'execute');
  check("jawab 'ya' -> execute", (await reviewPlan(tasks, io('ya'))) === 'execute');
  check("jawab 'Y' (kapital) -> execute", (await reviewPlan(tasks, io('Y'))) === 'execute');
  check("jawab 'r' -> replan", (await reviewPlan(tasks, io('r'))) === 'replan');
  check("jawab 'n' -> cancel", (await reviewPlan(tasks, io('n'))) === 'cancel');
  check("jawab 'ngawur' -> cancel (fail-closed)", (await reviewPlan(tasks, io('hmm gimana ya'))) === 'cancel');
  check('jawab KOSONG -> cancel (fail-closed)', (await reviewPlan(tasks, io(''))) === 'cancel');
  check("cuma enter/spasi -> cancel", (await reviewPlan(tasks, io('   '))) === 'cancel');

  const out2 = [];
  await reviewPlan(tasks, { print: (s) => out2.push(s), ask: async () => 'n', planAttempts: 2 });
  const all = out2.join('\n');
  check('rencana ditampilin sebelum ditanya', /Kode X/.test(all));
  check('dinyatakan BELUM dieksekusi', /belum dieksekusi|BELUM/i.test(all));
  check('jumlah percobaan LLM kelihatan kalau > 1', /2x percobaan/.test(all));
}

// ---------- [9] MAX_REPLANS ada dan masuk akal ----------
console.log('\n[9] batas susun ulang');

check('MAX_REPLANS integer >= 1', Number.isInteger(MAX_REPLANS) && MAX_REPLANS >= 1);
check('MAX_REPLANS wajar (<= 5)', MAX_REPLANS <= 5);

// ---------- [10] formatPlanForTelegram: gak nembus limit pesan ----------
console.log('\n[10] formatPlanForTelegram — batas panjang');

{
  const kecil = [{ id: 1, role: 'coder', brief: 'Kode', dependsOn: null }];
  check('rencana kecil gak kepotong', !/kepotong/.test(formatPlanForTelegram(kecil)));

  const besar = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, role: 'coder', brief: 'Tugas panjang nomor ' + i + ' '.repeat(20), dependsOn: null }));
  const t = formatPlanForTelegram(besar, 500);
  check('rencana gede dipotong di batas', t.length < 700);
  check('jujur bilang kepotong (bukan diam-diam buang)', /kepotong/.test(t));
}

// ---------- [11] buildHistoryText di-export (dipakai run-task) ----------
console.log('\n[11] buildHistoryText bisa diimport');

check('buildHistoryText fungsi', typeof buildHistoryText === 'function');
check('history kosong gak error', typeof buildHistoryText([]) === 'string' || buildHistoryText([]) === '');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
