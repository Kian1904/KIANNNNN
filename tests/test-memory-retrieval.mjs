// M54: test memory retrieval + db + distill (bareng, sesuai request).
// Pakai DB terpisah (KIAN_DATA_DIR) biar gak ganggu data asli.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Arahkan DB ke folder temp SEBELUM import db.js
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-mem-test-'));
process.env.HOME = TMP; // db.js pakai os.homedir()

const db = await import('../src/db.js');
const { retrieveRelevant, formatMemoryContext, tokenize, buildIdf, scoreRelevance, recencyBoost } = await import('../src/memory-retrieval.js');

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

console.log(`  (DB temp: ${db.getDbPath()})`);

// ── 1. DB: tulis & baca ──────────────────────────────────────────────────────
const tid = db.createThread('test thread');
check('createThread balikin id', typeof tid === 'number' && tid > 0);

db.logStep({ threadId: tid, role: 'user', content: 'bikin fitur login' });
db.logStep({ threadId: tid, role: 'assistant', content: 'oke', actionType: 'edit', reasoning: 'tambah auth' });
const conv = db.getConversation(tid, 10);
check('logStep + getConversation', conv.length === 2);
check('countConversations', db.countConversations() === 2);

// ── 2. DB: decisions ─────────────────────────────────────────────────────────
db.saveDecision({ key: 'database', value: 'pakai node:sqlite', context: 'hindari native module' });
db.saveDecision({ key: 'tui', value: 'pakai ink + react', context: 'JSX lebih readable' });
db.saveDecision({ key: 'bahasa', value: 'core tetap JavaScript', context: 'Go cuma buat algoritma murni' });
check('saveDecision + getAllDecisions', db.getAllDecisions().length === 3);
check('getDecisionsByKey', db.getDecisionsByKey('database').length === 1);
check('getDecisionsByKey case-insensitive', db.getDecisionsByKey('DATABASE').length === 1);

// ── 3. DB: learning ──────────────────────────────────────────────────────────
db.saveLearningSummary({ summary: 'Task sering gagal karena file besar dibaca sekaligus', sourceIds: [1, 2] });
db.saveLearningSummary({ summary: 'Provider cascade perlu fallback kalau timeout', sourceIds: [3] });
check('saveLearningSummary + getAllLearningSummaries', db.getAllLearningSummaries().length === 2);

// ── 4. DB: stats ─────────────────────────────────────────────────────────────
const stats = db.getMemoryStats();
check('getMemoryStats', stats.decisions === 3 && stats.learning === 2 && stats.conversations === 2);

// ── 5. Retrieval: tokenize ───────────────────────────────────────────────────
check('tokenize buang stopword', !tokenize('yang dan di ke').length);
check('tokenize simpan kata penting', tokenize('pakai node:sqlite').includes('sqlite'));

// ── 6. Retrieval: IDF ────────────────────────────────────────────────────────
const idf = buildIdf([['a', 'b'], ['a', 'c'], ['a', 'b']]);
check('IDF: kata langka > kata umum', idf.get('c') > idf.get('a'));

// ── 7. Retrieval: scoring ────────────────────────────────────────────────────
const idf2 = buildIdf([tokenize('pakai node sqlite'), tokenize('pakai ink react')]);
const s1 = scoreRelevance(tokenize('sqlite'), tokenize('pakai node sqlite'), idf2);
const s2 = scoreRelevance(tokenize('sqlite'), tokenize('pakai ink react'), idf2);
check('scoring: dokumen relevan > tidak relevan', s1 > s2);
check('scoring: query kosong = 0', scoreRelevance([], tokenize('apa saja'), idf2) === 0);

// ── 8. Retrieval: recency ────────────────────────────────────────────────────
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const old = new Date(Date.now() - 90 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
check('recency: baru > lama', recencyBoost(now) > recencyBoost(old));
check('recency: dalam 0..1', recencyBoost(now) <= 1 && recencyBoost(old) >= 0);

// ── 9. Retrieval: retrieveRelevant ───────────────────────────────────────────
const r1 = await retrieveRelevant('database sqlite');
check('retrieve: dapat keputusan relevan', r1.decisions.length > 0);
check('retrieve: yang paling relevan = database', r1.decisions[0]?.key === 'database');

const r2 = await retrieveRelevant('tui jsx react');
check('retrieve: query beda -> hasil beda', r2.decisions[0]?.key === 'tui');

const r3 = await retrieveRelevant('zzz tidak ada sama sekali');
check('retrieve: query gak relevan -> kosong', r3.decisions.length === 0);

const r4 = await retrieveRelevant('file besar timeout', { includeLearning: true });
check('retrieve: learning ikut keambil', r4.learning.length > 0);

// ── 10. Retrieval: format ────────────────────────────────────────────────────
const fmt = formatMemoryContext(r1);
check('format: ada header keputusan', fmt.includes('Keputusan relevan'));
check('format: kosong kalau gak ada hasil', formatMemoryContext({ decisions: [], learning: [] }) === '');

// ── 11. Distill (bareng) ─────────────────────────────────────────────────────
const { distillIfNeeded } = await import('../src/distill.js');
// Isi conversations sampai lewat threshold (200)
for (let i = 0; i < 210; i++) {
  db.logStep({ threadId: tid, role: 'assistant', content: `langkah ${i}`, actionType: 'edit', reasoning: `alasan ${i}` });
}
const before = db.countConversations();
check('distill: conversations > threshold', before > 200);

let askCalled = false;
await distillIfNeeded(async (sys, user) => {
  askCalled = true;
  check('distill: system prompt minta ringkasan pola', sys.includes('merangkum pola'));
  check('distill: user prompt berisi log', user.includes('Log langkah agent'));
  return 'Ringkasan pola: task edit sering, error timeout.';
});
const after = db.countConversations();
check('distill: askFn dipanggil', askCalled);
check('distill: conversations berkurang', after < before);
check('distill: learning summary tersimpan', db.getAllLearningSummaries().length === 3);

// ── 12. Distill: gak jalan kalau di bawah threshold ──────────────────────────
let askCalled2 = false;
await distillIfNeeded(async () => { askCalled2 = true; return 'x'; });
check('distill: skip kalau di bawah threshold', !askCalled2);

// cleanup
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n=== HASIL MEMORY: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
