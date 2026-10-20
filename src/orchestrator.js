// src/orchestrator.js — Lapisan orchestrator.
//
// FASE SEKARANG:
//   - Menyimpan "active agent" (state).
//   - runInstruction() meneruskan config agent aktif ke runTask.
//   - Routing MANUAL via /agent di REPL.
//   - M15: protokol delegasi JSON tervalidasi — plan() / parsePlan() / validatePlan().
//
// FASE BERIKUTNYA (M16, fan-out):
//   - Pakai hasil plan() buat dispatch beberapa worker PARALEL (context fresh +
//     tool whitelist tiap agent) -> aggregate -> jawaban final. Lihat SPEC.md.
//
// Written by K-sRouter

import { AGENTS, getAgent } from './agents.js';
import { runTask } from './run-task.js';
import { askWithFallback } from './providers.js';

/** @type {string|null} nama agent aktif; null = generic (perilaku lama persis) */
let activeAgentName = null;

/**
 * Ambil config agent yang sedang aktif.
 * @returns {import('./agents.js').AgentConfig|null}
 */
export function getActiveAgent() {
  return activeAgentName ? getAgent(activeAgentName) : null;
}

/**
 * Set agent aktif.
 * @param {string|null} name - nama agent, atau null untuk kembali ke generic
 * @returns {import('./agents.js').AgentConfig|null}
 */
export function setActiveAgent(name) {
  if (name === null || name === undefined) {
    activeAgentName = null;
    return null;
  }
  const agent = getAgent(name);
  if (!agent) {
    throw new Error(`Agent "${name}" tidak dikenal. Tersedia: ${Object.keys(AGENTS).join(', ')}`);
  }
  activeAgentName = name;
  return agent;
}

/**
 * Daftar semua agent yang terdaftar.
 * @returns {import('./agents.js').AgentConfig[]}
 */
export function listAgents() {
  return Object.values(AGENTS);
}

/**
 * Jalankan satu instruksi memakai agent aktif (atau generic kalau belum ada).
 * Signature sengaja sama dengan runTask + agentConfig sebagai argumen terakhir,
 * jadi pemanggil lama (REPL/Telegram) cukup ganti nama fungsi tanpa ubah argumen.
 */
export async function runInstruction(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval) {
  const agent = getActiveAgent();
  return runTask(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval, agent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// M15 — Protokol delegasi JSON tervalidasi
// ═══════════════════════════════════════════════════════════════════════════════

/** Batas jumlah task per rencana — nangkep runaway loop model gratisan. */
export const MAX_PLAN_TASKS = 4;

/**
 * Ekstrak objek/ array JSON paling besar dari teks kotor output LLM
 * (model gratisan suka bungkus JSON di markdown fence atau kasih prose).
 * @param {string} raw
 * @returns {any} hasil JSON.parse
 * @throws {Error} kalau gak ada JSON valid
 */
export function parsePlan(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Output orchestrator kosong.');
  }
  // 1) Buang thinking tag <think>...</think> (plan.js juga lakuin ini)
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // 2) Buang fence markdown ```json ... ``` atau ``` ... ```
  text = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1').trim();

  // 3) Coba parse utuh dulu
  try { return JSON.parse(text); } catch { /* lanjut cari substring */ }

  // 4) Cari objek JSON berimbang: '{' pertama sampai '}' terakhir
  const firstObj = text.indexOf('{');
  const lastObj = text.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) {
    try { return JSON.parse(text.slice(firstObj, lastObj + 1)); }
    catch { /* coba array */ }
  }

  // 5) Fallback: array '[' pertama sampai ']' terakhir
  const firstArr = text.indexOf('[');
  const lastArr = text.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) {
    try { return JSON.parse(text.slice(firstArr, lastArr + 1)); }
    catch { /* gagal */ }
  }

  throw new Error(`Tidak ada JSON valid di output orchestrator.\n--- raw ---\n${raw.slice(0, 500)}`);
}

/**
 * Validasi struktur rencana terhadap registry AGENTS.
 * Konsisten dengan gaya validateAgent: balikin ARRAY masalah (kosong = valid),
 * bukan boolean — biar semua masalah kelihatan sekaligus buat feedback ke LLM.
 * @param {any} plan
 * @returns {string[]}
 */
export function validatePlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return ['rencana harus berupa objek JSON dengan kunci "tasks"'];
  }
  const tasks = plan.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    problems.push('"tasks" harus array berisi minimal 1 task');
    return problems;
  }
  if (tasks.length > MAX_PLAN_TASKS) {
    problems.push(`jumlah task ${tasks.length} melebihi batas ${MAX_PLAN_TASKS} — pecah jadi rencana lebih simpel`);
  }

  const seenIds = new Set();
  tasks.forEach((t, i) => {
    const label = `tasks[${i}]`;
    if (!t || typeof t !== 'object') { problems.push(`${label} harus objek`); return; }

    // id wajib & unik
    if (t.id === undefined || t.id === null || t.id === '') {
      problems.push(`${label} wajib punya "id"`);
    } else if (seenIds.has(t.id)) {
      problems.push(`${label} id "${t.id}" duplikat — id harus unik`);
    } else {
      seenIds.add(t.id);
    }

    // role wajib ada di registry AGENTS
    if (!t.role || typeof t.role !== 'string') {
      problems.push(`${label} wajib punya "role"`);
    } else if (!AGENTS[t.role]) {
      problems.push(`${label} role "${t.role}" tidak dikenal — role valid: ${Object.keys(AGENTS).join(', ')}`);
    }

    // brief wajib non-kosong
    if (!t.brief || typeof t.brief !== 'string' || t.brief.trim() === '') {
      problems.push(`${label} wajib punya "brief" berisi penjelasan singkat tugas`);
    }
  });

  // dependsOn: null / undefined, atau merujuk id task yang ada (boleh diri sendiri? tidak)
  tasks.forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const dep = t.dependsOn;
    if (dep === null || dep === undefined) return;
    if (dep === t.id) {
      problems.push(`tasks[${i}] dependsOn dirinya sendiri (id ${dep})`);
    } else if (!seenIds.has(dep)) {
      problems.push(`tasks[${i}] dependsOn id ${dep} yang tidak ada di rencana ini`);
    }
  });

  // —— VALIDASI MAKNA (bukan cuma bentuk) ——
  // Sintaks bener ≠ rencana masuk akal. Tapi hati-hati: validator yang terlalu
  // galak LEBIH BURUK daripada gak ada validator, karena dia bikin squad gak
  // pernah kepake. Pelajaran mahal dari tes pertama: brief riset yang bunyinya
  // "...kumpulkan fakta untuk implementasi" kena tuduh "nyuruh edit" cuma karena
  // ada kata "implementasi". Itu riset yang SAH. Jadi arah kalimatnya dibaca,
  // bukan cuma ada-tidaknya kata.
  tasks.forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const label = `tasks[${i}]`;
    const agent = AGENTS[t.role];
    if (!agent) return; // role gak dikenal udah dilaporkan di atas

    const brief = String(t.brief || '').trim();

    // (a) Brief kelewat pendek = model cuma ngisi formalitas. Worker bakal
    // nanya-nanya sendiri dan hasilnya ngawur.
    if (brief.length > 0 && brief.length < 15) {
      problems.push(`${label} brief terlalu pendek ("${brief}") — jelaskan apa yang harus dikerjakan secara spesifik`);
    }

    // (b) Brief nyuruh KERJAAN yang DILARANG buat role itu.
    //
    // Yang dihitung cuma KATA KERJA IMPERATIF di depan brief. Alasannya: kata
    // benda seperti "implementasi" sering muncul sebagai OBJEK ("kumpulkan fakta
    // untuk implementasi") yang artinya justru riset, bukan ngoding.
    const imperativeWrite = /^\s*(edit|ubah|tulis|tulis ulang|buat|bikin|hapus|rename|pindah|pindahkan|refactor|patch|implementasi(kan)?|implement|perbaiki|fix|tambahkan|tambah|ganti|update|upgrade|hapuskan)\b/i;
    const readOnlyRoles = ['researcher', 'reviewer'];
    if (readOnlyRoles.includes(t.role) && imperativeWrite.test(brief)) {
      problems.push(`${label} role "${t.role}" read-only tapi brief-nya mulai dengan kata kerja MENGUBAH ("${brief.slice(0, 60)}...") — pakai role coder untuk pekerjaan yang mengubah file`);
    }
    if (t.role === 'coder' && /^\s*(riset|telusuri|googling|cari di web|web_search)\b/i.test(brief)) {
      problems.push(`${label} role "coder" tidak boleh web_search tapi brief-nya mulai dengan "riset/telusuri" — pisah jadi task researcher lalu coder dependsOn researcher`);
    }

    // (c) dependsOn salah arah: task yang cuma "baca/riset" ditaruh SETELAH
    // task yang mengubah file. Datanya jadi basi. Ini khas model gratisan.
    const dep = t.dependsOn;
    if (dep !== null && dep !== undefined) {
      const parent = tasks.find(x => x && x.id === dep);
      if (parent) {
        const parentWrites = imperativeWrite.test(String(parent.brief || ''));
        const childReadsOnly = /^\s*(baca|baca ulang|read|cek|periksa|verifikasi)\b/i.test(brief);
        if (parentWrites && childReadsOnly && t.role !== 'reviewer') {
          problems.push(`${label} membaca file SETELAH task ${dep} mengubahnya — hasilnya bisa basi; pastikan urutannya memang disengaja`);
        }
      }
    }
  });

  // (d) Rencana yang gak punya ujung: semua task saling bergantung tapi gak ada
  // yang bisa mulai. topologicalWaves() bakal throw — lebih baik ketangkep di sini.
  if (!problems.some(p => p.includes('dependsOn'))) {
    const ids = new Set(tasks.filter(t => t && typeof t === 'object' && t.id !== undefined).map(t => t.id));
    const hasRoot = tasks.some(t => t && typeof t === 'object' && (t.dependsOn === null || t.dependsOn === undefined) && ids.has(t.id));
    if (!hasRoot && tasks.length > 0) {
      problems.push('semua task punya dependsOn — tidak ada task yang bisa mulai (bikin minimal satu task dengan dependsOn: null)');
    }
  }

  return problems;
}

// System prompt orchestrator — self-contained, daftar role diambil dari AGENTS.
const ORCHESTRATOR_SYSTEM = `Kamu adalah ORCHESTRATOR. tugasmu MEMECAH task user jadi beberapa subtask
yang masing-masing dikerjakan oleh SATU agent spesialis. Kamu TIDAK mengerjakan task sendiri.

Daftar agent yang boleh kamu pakai (role):
${Object.values(AGENTS).map(a => `- ${a.name}: ${a.description}`).join('\n')}

Aturan:
- Balas HANYA dengan JSON valid. JANGAN tulis markdown fence, penjelasan, atau teks lain.
- Bentuk wajib:
  {"tasks":[{"id":1,"role":"<role>","brief":"<jelaskan singkat & spesifik apa yang harus dikerjakan, termasuk konteks yang dibutuhkan>","dependsOn":null}]}
- "id" angka unik dalam satu rencana.
- "role" HANYA salah satu dari daftar agent di atas.
- "dependsOn": null kalau task bisa langsung dikerjakan, ATAU id task lain yang HARUS selesai dulu (misal coder butuh hasil researcher).
- Maksimal ${MAX_PLAN_TASKS} task. Kalau task sederhana yang bisa dikerjakan satu agent, cukup 1 task.
- Kalau task user murni obrolan tanpa pekerjaan teknis, balas: {"tasks":[]}

Contoh — user: "riset cara kerja X lalu bikin kodenya":
{"tasks":[{"id":1,"role":"researcher","brief":"Cari dan rangkum cara kerja X, kumpulkan fakta teknis yang dibutuhkan untuk implementasi.","dependsOn":null},{"id":2,"role":"coder","brief":"Implementasikan fitur X berdasarkan hasil riset researcher di task 1.","dependsOn":1}]}`;

/**
 * Hasilkan rencana delegasi dari instruksi user.
 * - Panggil LLM (default: cascade askWithFallback) dengan prompt orchestrator.
 * - parsePlan() ekstrak JSON, validatePlan() cek silang ke registry AGENTS.
 * - Kalau validasi gagal, otomatis coba lagi (maks maxAttempts) dengan feedback
 *   masalah yang dikirim balik ke LLM — penting buat model gratisan.
 *
 * @param {string} instruction
 * @param {Function} [askFn] - override buat test (default askWithFallback)
 * @param {{maxAttempts?:number}} [opts]
 * @returns {Promise<{ok:boolean, tasks:Array, problems:string[], attempts:number, raw:string|null}>}
 */
export async function plan(instruction, askFn = askWithFallback, { maxAttempts = 2 } = {}) {
  let problems = [];
  let raw = null;

  let lastParsed = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = attempt === 1
      ? `Task user: ${instruction}`
      : `Task user: ${instruction}\n\nRENCANA SEBELUMNYA TIDAK VALID:\n${problems.map(p => `- ${p}`).join('\n')}\nPerbaiki dan balas dengan JSON yang valid saja.`;

    raw = await askFn(ORCHESTRATOR_SYSTEM, userPrompt);

    let parsed;
    try {
      parsed = parsePlan(raw);
    } catch (err) {
      problems = [err.message];
      continue;
    }
    lastParsed = parsed;

    const validationProblems = validatePlan(parsed);
    if (validationProblems.length === 0) {
      return { ok: true, tasks: parsed.tasks, problems: [], attempts: attempt, raw };
    }
    problems = validationProblems;
  }

  // Perhatikan: tasks tetap dikembalikan walau ok:false. Tanpa itu, satu-satunya
  // jejak rencana jelek cuma pesan error yang brief-nya udah dipotong — mustahil
  // didebug. tasks yang gak lolos validasi TIDAK boleh dieksekusi (executePlan
  // cek ok), tapi harus bisa DILIHAT.
  return { ok: false, tasks: (lastParsed && lastParsed.tasks) || [], problems, attempts: maxAttempts, raw, invalid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// M16 — Fan-out: eksekusi rencana ke agent beneran
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Kelompokkan task jadi "wave" berdasarkan dependsOn (topological order).
 * Tiap wave hanya berisi task yang dependensinya sudah ada di wave sebelumnya.
 * Protokol cuma mengizinkan dependsOn tunggal per task, jadi ini sederhana.
 *
 * @param {Array} tasks - dari hasil plan() (sudah tervalidasi)
 * @returns {Array<Array>} array of waves; tiap wave = array task
 * @throws {Error} kalau ada cycle / dependensi nggak terpenuhi (defensif)
 */
export function topologicalWaves(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const done = new Set();
  const remaining = tasks.map(t => t.id);
  const waves = [];

  while (remaining.length > 0) {
    const ready = remaining.filter(id => {
      const dep = byId.get(id).dependsOn;
      return dep === null || dep === undefined || done.has(dep);
    });

    if (ready.length === 0) {
      // validatePlan harusnya udah nangkep ini; ini jaring pengaman terakhir
      throw new Error(`Cycle/dependensi tak terpenuhi di rencana. Sisa task: ${remaining.join(', ')}`);
    }

    ready.forEach(id => { done.add(id); });
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (ready.includes(remaining[i])) remaining.splice(i, 1);
    }
    waves.push(ready.map(id => byId.get(id)));
  }

  return waves;
}

/**
 * Susun instruksi kerja buat satu worker: konteks task besar + brief spesifik
 * + hasil dependency (kalau ada) biar worker paham posisinya dalam rencana.
 */
function buildWorkerInstruction(task, originalInstruction, depSummary) {
  let instr = `Konteks task besar dari user: ${originalInstruction}\n\n`;
  instr += `Tugasmu (role ${task.role}): ${task.brief}`;
  if (depSummary) {
    instr += `\n\nHasil task sebelumnya yang harus kamu pakai sebagai bahan:\n${depSummary}`;
  }
  instr += `\n\nKerjakan TUGASMU SAJA sesuai brief di atas. Jangan kerjakan bagian lain.`;
  return instr;
}

function aggregateResults(results) {
  return results
    .map(r => `[${r.role} — task ${r.id}]\n${r.summary}`)
    .join('\n\n' + '─'.repeat(40) + '\n\n');
}

/**
 * Eksekusi rencana hasil plan(): dispatch tiap task ke agent sesuai role,
 * context fresh per worker (context isolation), hormati dependsOn (wave),
 * lalu aggregate jadi ringkasan final.
 *
 * DESAIN: task dalam satu wave dijalankan SEKUENSIAL, bukan paralel — alasannya
 * (1) askApproval pakai readline, nggak aman kalau dua worker interaktif
 * barengan; (2) provider gratisan kena rate limit, paralel malah lebih lambat.
 * Kalau nanti mau paralel, tukar inner loop jadi Promise.allSettled — struktur
 * wave-nya udah siap.
 *
 * M17: satu worker yang MELEMPAR error TIDAK mematikan seluruh squad — error
 * dikarantina jadi summary task itu ("TASK GAGAL: ..."), task lain lanjut, dan
 * dependensi turunannya tetap terima hasil (walau isinya error) supaya bisa
 * memutuskan sendiri. Deps ke-3 opsional biar test bisa inject runTask palsu.
 *
 * @param {{ok:boolean, tasks:Array, problems:string[]}} planResult - hasil plan()
 * @param {Object} ctx - { originalInstruction, agentMd, availableTools, threadId,
 *                         stats, trackProvider, trackAction, isDangerous, askApproval }
 * @param {{runTask?:Function}} [deps] - override (test); default pakai runTask asli
 * @returns {Promise<{ok:boolean, fallback:boolean, results:Array, finalSummary:string, problems:string[]}>}
 */
export async function executePlan(planResult, ctx, deps = {}) {
  const {
    originalInstruction, agentMd, availableTools, threadId,
    stats, trackProvider, trackAction, isDangerous, askApproval,
  } = ctx;
  const runTaskFn = deps.runTask || runTask;

  // Rencana gagal / kosong -> sinyal fallback (pemanggil jalanin task generic)
  if (!planResult || !planResult.ok) {
    return { ok: false, fallback: true, results: [], finalSummary: '', problems: planResult?.problems || ['rencana tidak valid'] };
  }
  if (planResult.tasks.length === 0) {
    return { ok: true, fallback: false, results: [], finalSummary: 'Tidak ada subtask teknis — cukup obrolan.', problems: [] };
  }

  let waves;
  try {
    waves = topologicalWaves(planResult.tasks);
  } catch (err) {
    return { ok: false, fallback: true, results: [], finalSummary: '', problems: [err.message] };
  }

  const results = [];
  const summaryById = new Map();

  for (const wave of waves) {
    for (const task of wave) {
      const agent = getAgent(task.role);   // role tervalidasi, pasti ada
      const depSummary = task.dependsOn != null ? summaryById.get(task.dependsOn) : null;
      const instruction = buildWorkerInstruction(task, originalInstruction, depSummary);

      const summary = await runTaskFn(
        instruction, agentMd, availableTools, threadId,
        stats, trackProvider, trackAction, isDangerous, askApproval, agent
      ).catch(err => {
        // Karantina: worker gagal total (crash, provider mati, dsb) —
        // jadikan error jadi summary task ini, squad TETAP lanjut.
        console.error(`[squad] worker task ${task.id} (${task.role}) gagal:`, err.message);
        return `TASK GAGAL: ${err.message}`;
      });

      const clean = typeof summary === 'string' && summary.trim()
        ? summary.trim()
        : '(worker tidak memberi ringkasan — kemungkinan habis loop tanpa done)';
      summaryById.set(task.id, clean);
      results.push({ id: task.id, role: task.role, summary: clean });
    }
  }

  return { ok: true, fallback: false, results, finalSummary: aggregateResults(results), problems: [] };
}
