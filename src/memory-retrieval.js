// src/memory-retrieval.js — ambil memory RELEVAN (bukan cuma "terbaru").
//
// Kenapa ini ada: sebelum M54, memory cuma bisa dibaca "N terbaru"
// (getRecentDecisions). Artinya keputusan relevan dari 500 task lalu HILANG —
// agent "inget" yang terakhir, bukan yang penting. Modul ini memberi scoring
// relevansi supaya memory yang di-inject ke prompt beneran nyambung.
//
// Pendekatan: TF-IDF sederhana + recency boost. Tanpa embedding (biar ringan
// di Termux, tanpa dependency). Kalau nanti butuh lebih akurat, tinggal ganti
// fungsi score().
//
// Written by K'

const STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'adalah',
  'ini', 'itu', 'atau', 'juga', 'akan', 'sudah', 'tidak', 'bisa', 'ada',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
  'for', 'with', 'and', 'or', 'but', 'not', 'this', 'that', 'it', 'be',
]);

/**
 * Tokenisasi sederhana: lowercase, buang non-alfanumerik, buang stopword.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Hitung TF (term frequency) dari token.
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/**
 * Bangun IDF dari korpus dokumen.
 * @param {string[][]} docs - array token per dokumen
 * @returns {Map<string, number>}
 */
export function buildIdf(docs) {
  const df = new Map();
  for (const tokens of docs) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = docs.length || 1;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(1 + n / d));
  return idf;
}

/**
 * Skor relevansi query terhadap dokumen (cosine-ish TF-IDF).
 * @param {string[]} queryTokens
 * @param {string[]} docTokens
 * @param {Map<string, number>} idf
 * @returns {number}
 */
export function scoreRelevance(queryTokens, docTokens, idf) {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const docTf = termFreq(docTokens);
  const docLen = docTokens.length;
  let score = 0;
  for (const qt of new Set(queryTokens)) {
    const tf = docTf.get(qt);
    if (!tf) continue;
    const w = idf.get(qt) ?? 1;
    score += (tf / docLen) * w;
  }
  return score;
}

/**
 * Boost berdasarkan kebaruan (recency). Makin baru makin tinggi.
 * @param {string} createdAt - SQLite datetime
 * @param {number} halfLifeDays
 * @returns {number} 0..1
 */
export function recencyBoost(createdAt, halfLifeDays = 30) {
  if (!createdAt) return 0.5;
  const t = new Date(String(createdAt).replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return 0.5;
  const ageDays = (Date.now() - t) / 86400000;
  if (ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Ambil memory relevan dari DB.
 *
 * @param {string} query - task/pertanyaan sekarang
 * @param {object} [opts]
 * @param {number} [opts.limit=5]      jumlah hasil maksimal
 * @param {number} [opts.minScore=0.01] ambang skor minimum
 * @param {number} [opts.recencyWeight=0.3] bobot recency (0 = abaikan)
 * @param {boolean} [opts.includeLearning=true] ikut sertakan ringkasan learning
 * @returns {Promise<{decisions: Array, learning: Array}>}
 */
export async function retrieveRelevant(query, opts = {}) {
  const {
    limit = 5,
    minScore = 0.01,
    recencyWeight = 0.3,
    includeLearning = true,
  } = opts;

  const db = await import('./db.js');
  const queryTokens = tokenize(query);

  // Kumpulkan dokumen: keputusan + (opsional) learning
  const decisions = db.getAllDecisions();
  const learning = includeLearning ? db.getAllLearningSummaries() : [];

  const docs = [
    ...decisions.map((d) => ({ kind: 'decision', row: d, text: `${d.key} ${d.value} ${d.context || ''}` })),
    ...learning.map((l) => ({ kind: 'learning', row: l, text: l.summary })),
  ];

  if (docs.length === 0) return { decisions: [], learning: [] };

  const docTokens = docs.map((d) => tokenize(d.text));
  const idf = buildIdf(docTokens);

  const scored = docs.map((d, i) => {
    const rel = scoreRelevance(queryTokens, docTokens[i], idf);
    const rec = recencyBoost(d.row.created_at);
    const final = rel * (1 - recencyWeight) + rec * recencyWeight * (rel > 0 ? 1 : 0.1);
    return { ...d, relevance: rel, recency: rec, score: final };
  });

  const filtered = scored
    .filter((s) => s.relevance >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    decisions: filtered.filter((f) => f.kind === 'decision').map((f) => ({
      ...f.row, relevance: f.relevance, score: f.score,
    })),
    learning: filtered.filter((f) => f.kind === 'learning').map((f) => ({
      ...f.row, relevance: f.relevance, score: f.score,
    })),
  };
}

/**
 * Format hasil retrieval jadi teks siap-inject ke prompt.
 * @param {{decisions: Array, learning: Array}} result
 * @returns {string} '' kalau kosong
 */
export function formatMemoryContext(result) {
  const parts = [];
  if (result.decisions?.length) {
    parts.push('Keputusan relevan sebelumnya:');
    for (const d of result.decisions) {
      parts.push(`- ${d.key}: ${d.value}${d.context ? ` (${d.context})` : ''}`);
    }
  }
  if (result.learning?.length) {
    parts.push('Pelajaran dari task sebelumnya:');
    for (const l of result.learning) {
      parts.push(`- ${l.summary}`);
    }
  }
  return parts.join('\n');
}
