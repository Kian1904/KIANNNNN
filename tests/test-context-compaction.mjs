// M55: test context compaction (komponen terakhir) — bareng memory + distill.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-ctx-test-'));
process.env.HOME = TMP;

const { compactHistory, summarizeEntry, truncateContent, estimateTokens } = await import('../src/context-compaction.js');
const { buildHistoryText } = await import('../src/plan.js');

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

// ── 1. summarizeEntry ────────────────────────────────────────────────────────
check('summarize: read', summarizeEntry({ action: 'read', target: 'a.js', content: 'x'.repeat(500) }, 0).includes('READ a.js'));
check('summarize: read sebut ukuran', summarizeEntry({ action: 'read', target: 'a.js', content: 'x'.repeat(500) }, 0).includes('500 char'));
check('summarize: edit diterapkan', summarizeEntry({ action: 'edit', target: 'b.js', approved: true }, 0).includes('diterapkan'));
check('summarize: edit ditolak', summarizeEntry({ action: 'edit', target: 'b.js', approved: false }, 0).includes('DITOLAK'));
check('summarize: bash error', summarizeEntry({ action: 'bash', command: 'npm test', error: 'fail' }, 0).includes('ERROR'));
check('summarize: unknown action gak crash', typeof summarizeEntry({ action: 'xyz' }, 0) === 'string');

// ── 2. truncateContent ───────────────────────────────────────────────────────
const short = 'abc';
check('truncate: pendek gak diubah', truncateContent(short, 100) === short);
const long = 'A'.repeat(1000) + 'B'.repeat(1000);
const tr = truncateContent(long, 200);
check('truncate: panjang dipotong', tr.length < long.length);
check('truncate: ada penanda DIPOTONG', tr.includes('DIPOTONG'));
check('truncate: simpan awal & akhir', tr.startsWith('A') && tr.endsWith('B'));

// ── 3. compactHistory: kosong ────────────────────────────────────────────────
const empty = compactHistory([]);
check('compact: kosong', empty.text === '(belum ada langkah)' && !empty.compacted);

// ── 4. compactHistory: sedikit langkah (gak perlu kompak) ────────────────────
const few = [
  { action: 'read', target: 'a.js', content: 'isi a' },
  { action: 'edit', target: 'a.js', approved: true },
];
const rFew = compactHistory(few, { keepRecent: 8 });
check('compact: sedikit -> gak ada ringkasan', !rFew.compacted);
check('compact: sedikit -> isi file tetap ada', rFew.text.includes('isi a'));

// ── 5. compactHistory: banyak langkah (perlu kompak) ─────────────────────────
const many = [];
for (let i = 0; i < 50; i++) {
  many.push({ action: 'read', target: `file${i}.js`, content: 'X'.repeat(3000) });
}
const rMany = compactHistory(many, { keepRecent: 8 });
check('compact: banyak -> compacted', rMany.compacted);
check('compact: ringkas 42 langkah awal', rMany.summarized === 42);
check('compact: ada header ringkasan', rMany.text.includes('[RINGKASAN 42 LANGKAH AWAL]'));
check('compact: ada penutup ringkasan', rMany.text.includes('[AKHIR RINGKASAN]'));
check('compact: langkah terakhir tetap detail', rMany.text.includes('Langkah 50: READ file49.js'));

// ── 6. compactHistory: hemat karakter ────────────────────────────────────────
const before = buildHistoryText(many);
const after = rMany.text;
check('compact: jauh lebih pendek dari asli', after.length < before.length / 2);
console.log(`    (asli ${before.length} char -> kompak ${after.length} char, hemat ${Math.round((1 - after.length / before.length) * 100)}%)`);

// ── 7. compactHistory: batas total ───────────────────────────────────────────
const huge = [];
for (let i = 0; i < 500; i++) huge.push({ action: 'read', target: `f${i}.js`, content: 'Y'.repeat(5000) });
const rHuge = compactHistory(huge, { keepRecent: 8, maxTotal: 10000 });
check('compact: hormati maxTotal', rHuge.text.length <= 12000);
check('compact: sebut langkah dipotong', rHuge.text.includes('dipotong'));

// ── 8. estimateTokens ────────────────────────────────────────────────────────
check('estimateTokens: kasar char/4', estimateTokens('a'.repeat(400)) === 100);
check('estimateTokens: kosong = 0', estimateTokens('') === 0);

// ── 9. Integrasi: memory + distill + compaction bareng ───────────────────────
const db = await import('../src/db.js');
const { retrieveRelevant } = await import('../src/memory-retrieval.js');
const { distillIfNeeded } = await import('../src/distill.js');

db.saveDecision({ key: 'compaction', value: 'ringkas langkah lama', context: 'hemat token' });
const mem = await retrieveRelevant('compaction token');
check('integrasi: retrieval nemu keputusan compaction', mem.decisions.some(d => d.key === 'compaction'));

const tid = db.createThread('ctx test');
for (let i = 0; i < 210; i++) db.logStep({ threadId: tid, role: 'assistant', content: `step ${i}`, actionType: 'edit' });
await distillIfNeeded(async () => 'ringkasan pola');
check('integrasi: distill jalan', db.getAllLearningSummaries().length >= 1);
check('integrasi: compaction tetap jalan setelah distill', compactHistory(many, { keepRecent: 8 }).compacted);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n=== HASIL COMPACTION: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
