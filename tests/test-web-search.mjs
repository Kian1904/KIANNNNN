/**
 * Smoke test: web search + reasoning + summary (3 steps)
 * Step 1-2: web_search action
 * Step 3: reasoning & summary
 */
import { searchWeb } from '../src/search.js';
import { planStep } from '../src/plan.js';

const base = { fileSnapshot: '-', agentMd: null, recentMemory: [], availableTools: [] };

// Step 1: Ask for web search
const askSearch = async () => 'REASONING: user mau cari berita terbaru\nACTION: web_search\nQUERY: berita terbaru Indonesia';

// Step 2: After search, ask for reasoning/summary
const askSummary = async () => 'REASONING: berdasarkan hasil search, buatkan ringkasan poin-poin penting\nACTION: done\nSUMMARY: ok';

(async () => {
  console.log('=== Step 1: Parse web_search action ===');
  const s1 = await planStep(askSearch, { ...base, instruction: 'cari berita terbaru', history: [] });
  if (s1.action !== 'web_search' || !s1.query || s1.query.toLowerCase().indexOf('berita') === -1) {
    throw new Error('T1 GAGAL: action atau query salah -> ' + JSON.stringify(s1));
  }
  console.log('T1 web_search parse  : OK ->', s1.query);

  console.log('\n=== Step 2: Parse done action (after search) ===');
  const hist = [
    { action: 'web_search', query: s1.query, provider: s1.provider, summary: s1.summary || '(belum ada)' },
  ];
  const s2 = await planStep(askSummary, { ...base, instruction: 'tampilkan hasil', history: hist });
  if (s2.action !== 'done') throw new Error('T2 GAGAL: ' + JSON.stringify(s2));
  console.log('T2 done parse        : OK ->', s2.summary);

  console.log('\n=== Step 3: Verify summary exists (content check) ===');
  if (!s2.summary) throw new Error('T3 GAGAL: summary null/undefined');
  console.log('T3 summary valid     : OK ->', s2.summary);

  console.log('\n✅ SEMUA TEST WEB SEARCH LULUS');
})().catch(err => {
  console.error('❌ TEST GAGAL:', err.message);
  process.exit(1);
});