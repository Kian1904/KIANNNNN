// lib/search.js — Web search cascade: Serper → Tavily
// Kontrak: searchWeb(query) selalu balikin { provider, results: [{title, url, snippet}] }
// atau throw kalau semua provider gagal.

const TIMEOUT_MS = 10000;

function withTimeout(fn) {
  return async (query) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fn(query, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** @param {string} query @param {AbortSignal} signal */
async function searchSerper(query, signal) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('SERPER_API_KEY belum di-set di .env');

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query }),
    signal
  });
  if (!res.ok) throw new Error(`Serper API error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const organic = data.organic || [];
  return organic.slice(0, 5).map(r => ({
    title: r.title || '(tanpa judul)',
    url: r.link,
    snippet: r.snippet || ''
  }));
}

/** @param {string} query @param {AbortSignal} signal */
async function searchTavily(query, signal) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY belum di-set di .env');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5
    }),
    signal
  });
  if (!res.ok) throw new Error(`Tavily API error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const results = data.results || [];
  return results.slice(0, 5).map(r => ({
    title: r.title || '(tanpa judul)',
    url: r.url,
    snippet: r.content || ''
  }));
}

// ── Cascade order (sesuai SPEC M11: Serper → Tavily) ──────────────────────────
const SEARCH_ORDER = [
  { name: 'Serper', fn: withTimeout(searchSerper) },
  { name: 'Tavily', fn: withTimeout(searchTavily) }
];

export const searchFallbackState = { lastProvider: null };

/**
 * Cari web, cascade Serper → Tavily. Hasil dipotong max 5 per provider.
 * Caller (index.js) yang nentuin apa hasil mentah ini ditampilkan ke user
 * atau cuma dipush ke history buat direasoning-in LLM di langkah berikutnya.
 * @param {string} query
 * @returns {Promise<{ provider: string, results: { title: string, url: string, snippet: string }[] }>}
 */
export async function searchWeb(query) {
  const errors = [];
  for (const p of SEARCH_ORDER) {
    try {
      const results = await p.fn(query);
      searchFallbackState.lastProvider = p.name;
      return { provider: p.name, results };
    } catch (err) {
      errors.push(`${p.name}: ${err.message.slice(0, 150)}`);
      console.log(`[SEARCH_FALLBACK] ${p.name} gagal (${err.message.slice(0, 200)}) — coba provider berikutnya...`);
    }
  }
  searchFallbackState.lastProvider = null;
  throw new Error(`Semua search provider gagal:\n${errors.join('\n')}`);
}
