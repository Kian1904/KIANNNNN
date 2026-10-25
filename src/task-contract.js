// M47: task contract — goal, constraint, dan acceptance criteria.
//
// Kenapa ini ada: tanpa kontrak eksplisit, agent bisa "selesai" tanpa benar-benar
// memenuhi maksud user. Kontrak di sini murni deterministik (tanpa LLM, tanpa
// network) supaya bisa diuji dan gak bisa diakalin model.
//
// Written by K'

const MAX_GOAL_LEN = 400;

/** Basa-basi pembuka yang bukan inti instruksi. */
const FILLER_OPENERS = /^(halo|hai|hi|hey|woi|oy|oyy|pagi|siang|sore|malam|oke|ok|sip|kaccan|kiann)\b[\s,!.]*/i;

/**
 * Kalimat scaffolding internal KIANNNNN — bukan instruksi user, jadi TIDAK boleh
 * dianggap constraint. Tanpa ini, brief worker squad ("Jangan kerjakan bagian
 * lain") terbaca sebagai larangan user dan malah memblokir worker itu sendiri.
 */
const SCAFFOLDING_PATTERNS = [
  /jangan kerjakan bagian lain/gi,
  /kerjakan tugasmu saja[^.\n]*/gi,
  /konteks task besar dari user:[^\n]*/gi,
  /hasil task sebelumnya yang harus kamu pakai[^\n]*/gi,
  /tugasmu \(role [a-z]+\):/gi,
];

function stripScaffolding(text) {
  let out = String(text == null ? '' : text);
  for (const pattern of SCAFFOLDING_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

/** Kalimat yang menandakan larangan. */
const PROHIBITION_PATTERNS = [
  /\b(jangan|jgn|gak boleh|ga boleh|tidak boleh|tidak usah|gausah|gak usah|tanpa)\b[^.,;!?\n]{0,160}/gi,
];

/** Kalimat yang menandakan kewajiban. */
const REQUIREMENT_PATTERNS = [
  /\b(wajib|harus|mesti|must)\b[^.,;!?\n]{0,160}/gi,
];

/** Kalimat yang menandakan batas kuantitatif. */
const LIMIT_PATTERNS = [
  /\b(maksimal|maks|maximum|maksimum|paling banyak|minimal|paling sedikit|hanya|hanya boleh|max)\b[^.,;!?\n]{0,160}/gi,
];

/** Kata kunci yang membuat instruksi berisiko tinggi. */
const HIGH_RISK_WORDS = [
  /\b(hapus|delete|remove|rm|drop|truncate|wipe|format|reformat)\b/i,
  /\b(sudo|root|chmod\s+777|curl\s+.*\|\s*(ba)?sh)\b/i,
  /\b(push|force|force-push|reset\s+--hard)\b/i,
  /\/dev\/(sd|block)/i,
];

/**
 * Buang frasa yang berada di dalam klausa larangan ("jangan ubah X") sebelum
 * menilai risiko. Tanpa ini, "rapihin auth tapi jangan hapus test" dinilai
 * high-risk padahal user justru MEMINTA agar tidak menghapus.
 */
function stripProhibitionClauses(text) {
  return String(text).replace(
    /\b(jangan|jgn|gak boleh|ga boleh|tidak boleh|tidak usah|gausah|gak usah|tanpa)\b[^.,;!?\n]{0,160}/gi,
    ' '
  );
}

/** Kata kunci yang menaikkan risiko ke sedang. */
const MEDIUM_RISK_WORDS = [
  /\b(edit|tulis|ubah|modify|refactor|rename|move|pindah|install|upgrade)\b/i,
  /\b(git|commit|branch|merge|rebase)\b/i,
];

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function shortHash(text) {
  // FNV-1a 32-bit — cukup buat id deterministik, zero-dependency.
  let hash = 0x811c9dc5;
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Ambil inti instruksi user, bukan basa-basi pembuka.
 * @param {string} instruction
 * @returns {string}
 */
export function extractGoal(instruction) {
  const raw = String(instruction == null ? '' : instruction);
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';

  // Baris pertama yang bukan sapaan basi dipakai sebagai inti goal.
  const meaningful = lines.find(line => {
    const stripped = line.replace(FILLER_OPENERS, '').trim();
    return stripped.length > 0;
  }) || lines[0];

  const goal = cleanText(meaningful.replace(FILLER_OPENERS, ''));
  const text = goal || cleanText(meaningful);
  return text.length > MAX_GOAL_LEN ? `${text.slice(0, MAX_GOAL_LEN - 1)}…` : text;
}

function collectMatches(instruction, patterns, kind) {
  const found = [];
  const seen = new Set();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of String(instruction).matchAll(pattern)) {
      const text = cleanText(match[0]).replace(/[.,;!?]+$/, '');
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ kind, text });
    }
  }
  return found;
}

/**
 * Ekstrak constraint dari instruksi: larangan, kewajiban, dan batas kuantitatif.
 * @param {string} instruction
 * @returns {Array<{kind:'prohibition'|'requirement'|'limit', text:string}>}
 */
export function extractConstraints(instruction) {
  const text = stripScaffolding(instruction);
  if (!text.trim()) return [];

  const constraints = [
    ...collectMatches(text, PROHIBITION_PATTERNS, 'prohibition'),
    ...collectMatches(text, REQUIREMENT_PATTERNS, 'requirement'),
    ...collectMatches(text, LIMIT_PATTERNS, 'limit'),
  ];

  // Buang hasil yang isinya kosong setelah keyword (mis. "jangan" doang).
  return constraints.filter(c => c.text.split(/\s+/).length >= 2);
}

/**
 * Turunkan acceptance criteria dari instruksi + constraint.
 * Kriteria dipakai gerbang selesai: semua harus punya bukti.
 * @param {{instruction?: string, constraints?: Array}} input
 * @returns {Array<{id:string, text:string, source:string, required:boolean}>}
 */
export function deriveAcceptanceCriteria(input = {}) {
  const instruction = cleanText(input.instruction);
  const constraints = Array.isArray(input.constraints) ? input.constraints : [];
  const criteria = [];

  const push = (text, source) => {
    const id = `ac-${shortHash(`${source}:${text}`)}`;
    if (criteria.some(c => c.id === id)) return;
    criteria.push({ id, text, source, required: true });
  };

  // Constraint selalu jadi kriteria: kalau user bilang "jangan ubah API publik",
  // kepatuhan itu WAJIB dibuktikan, bukan diasumsikan.
  for (const constraint of constraints) {
    push(`Mematuhi constraint (${constraint.kind}): ${constraint.text}`, 'constraint');
  }

  const lower = instruction.toLowerCase();

  // Kriteria dasar: kerja nyata harus punya jejak yang bisa dibaca ulang.
  push('Semua perubahan file/code yang diklaim sudah dibaca ulang dan cocok dengan maksud instruksi', 'baseline');

  // Batas kuantitatif ("maksimal 3 file") wajib dibuktikan angkanya, bukan
  // sekadar dinyatakan patuh. Ini yang paling sering diklaim palsu oleh agent.
  const hasLimit = constraints.some(c => c.kind === 'limit');
  if (hasLimit) {
    push('Jumlah/ukuran yang dibatasi dihitung dari hasil aktual, bukan dari klaim', 'measurement');
  }

  if (/\b(test|tes|uji|spec|unit|integration|regressi)\b/i.test(lower)) {
    push('Perintah test dijalankan dan exit code 0 dibuktikan dari output aktual', 'verification');
  }
  if (/\b(file|berkas|src\/|tests\/|\.[a-z]{1,4}\b)/i.test(lower)) {
    push('File target benar-benar ada setelah aksi dan isinya terverifikasi', 'verification');
  }
  if (/\b(install|pasang|npm|pip|apt|pkg)\b/i.test(lower)) {
    push('Instalasi berhasil dibuktikan dari output command, bukan asumsi', 'verification');
  }
  if (/\b(riset|research|cari|search|sumber|source)\b/i.test(lower)) {
    push('Temuan riset disertai sumber aktual yang bisa ditelusuri', 'evidence');
  }
  if (/\b(debug|error|bug|gagal|rusak|crash)\b/i.test(lower)) {
    push('Penyebab masalah ditunjukkan oleh bukti (log/output), bukan tebakan', 'diagnosis');
  }

  push('Ringkasan akhir hanya menyebut hal yang benar-benar dibuktikan', 'baseline');

  return criteria;
}

/**
 * Tentukan level risiko instruksi.
 * @param {string} instruction
 * @returns {'low'|'medium'|'high'}
 */
export function assessRisk(instruction) {
  const text = stripProhibitionClauses(stripScaffolding(instruction));
  if (HIGH_RISK_WORDS.some(re => re.test(text))) return 'high';
  if (MEDIUM_RISK_WORDS.some(re => re.test(text))) return 'medium';
  return 'low';
}

/**
 * Bangun kontrak lengkap dari instruksi user.
 * @param {string} instruction
 * @returns {{goal:string, constraints:Array, acceptance:Array, risk:string, instruction:string}}
 */
export function buildTaskContract(instruction) {
  const raw = String(instruction == null ? '' : instruction);
  const constraints = extractConstraints(raw);
  return {
    goal: extractGoal(raw),
    constraints,
    acceptance: deriveAcceptanceCriteria({ instruction: raw, constraints }),
    risk: assessRisk(raw),
    instruction: cleanText(raw).slice(0, MAX_GOAL_LEN * 4),
  };
}

/**
 * Gerbang selesai: apakah kontrak masih memblokir klaim done?
 * @param {{acceptance?: Array}|null} contract
 * @param {Array<{id:string,status:string,evidence?:string}>} results
 * @returns {{blocked:boolean, reason:string, pending:string[]}}
 */
export function contractBlocksCompletion(contract, results = []) {
  if (!contract || !Array.isArray(contract.acceptance) || contract.acceptance.length === 0) {
    return { blocked: false, reason: 'tidak ada kontrak aktif', pending: [] };
  }

  const byId = new Map();
  for (const item of Array.isArray(results) ? results : []) {
    if (item && item.id) byId.set(item.id, item);
  }

  const pending = [];
  for (const criterion of contract.acceptance) {
    const result = byId.get(criterion.id);
    if (!result) {
      pending.push(criterion.text);
      continue;
    }
    const statusOk = result.status === 'completed';
    const evidenceOk = typeof result.evidence === 'string' && result.evidence.trim().length > 0;
    if (!statusOk || !evidenceOk) pending.push(criterion.text);
  }

  if (pending.length === 0) {
    return { blocked: false, reason: 'semua kriteria terbukti', pending: [] };
  }
  return {
    blocked: true,
    reason: `masih ada ${pending.length} kriteria yang belum dibuktikan`,
    pending,
  };
}

/**
 * Render kontrak jadi teks yang bisa dibaca manusia (CLI/Telegram).
 * @param {object|null} contract
 * @returns {string}
 */
export function renderContract(contract) {
  if (!contract || typeof contract !== 'object') return '';

  const lines = [];
  if (contract.goal) lines.push(`GOAL: ${contract.goal}`);
  if (contract.risk) lines.push(`RISK: ${contract.risk}`);

  if (Array.isArray(contract.constraints) && contract.constraints.length) {
    lines.push('CONSTRAINT:');
    for (const c of contract.constraints) lines.push(`  - [${c.kind}] ${c.text}`);
  }

  if (Array.isArray(contract.acceptance) && contract.acceptance.length) {
    lines.push('ACCEPTANCE CRITERIA:');
    for (const a of contract.acceptance) lines.push(`  - (${a.id}) ${a.text}`);
  }

  return lines.join('\n');
}
