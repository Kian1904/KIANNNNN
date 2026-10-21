// M37-M38: deterministic research engine + structured evidence packet.
import { focusWebText, buildResearchFallback } from './web-fetch.js';

const OFFICIAL_PATTERNS = [/bmkg\.go\.id/i, /\.gov\./i, /\.go\.id\//i, /wttr\.in/i, /weather\.com/i];

export function rankSources(sources = [], query = '') {
  const q = String(query).toLowerCase();
  return [...sources].sort((a, b) => {
    const aOff = OFFICIAL_PATTERNS.some(p => p.test(a.url)) ? 1 : 0;
    const bOff = OFFICIAL_PATTERNS.some(p => p.test(b.url)) ? 1 : 0;
    if (aOff !== bOff) return bOff - aOff;
    const aMatch = (a.snippet || '').toLowerCase().includes(q.split(' ')[0]) ? 1 : 0;
    const bMatch = (b.snippet || '').toLowerCase().includes(q.split(' ')[0]) ? 1 : 0;
    return bMatch - aMatch;
  });
}

function extractFacts(text, sourceUrl) {
  const lines = String(text).split('\n');
  const facts = [];
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (/temp|suhu|feelslike/i.test(key)) facts.push({ key: 'temperature', value: val.replace(/[^\d.-]/g, ''), unit: 'C', source: sourceUrl });
    else if (/humidity|kelembapan/i.test(key)) facts.push({ key: 'humidity', value: val.replace(/[^\d.-]/g, ''), unit: '%', source: sourceUrl });
    else if (/weatherdesc|condition|cuaca|kondisi/i.test(key)) facts.push({ key: 'condition', value: val, source: sourceUrl });
    else if (/windspeed|angin/i.test(key)) facts.push({ key: 'wind_speed', value: val.replace(/[^\d.-]/g, ''), unit: 'km/h', source: sourceUrl });
    else if (/pressure/i.test(key)) facts.push({ key: 'pressure', value: val.replace(/[^\d.-]/g, ''), unit: 'hPa', source: sourceUrl });
    else if (/visibility/i.test(key)) facts.push({ key: 'visibility', value: val, source: sourceUrl });
  }
  return facts;
}

export function buildEvidencePacket(topic, fetchResults = []) {
  const facts = [];
  const sources = [];
  for (const r of fetchResults) {
    if (!r || !r.url) continue;
    sources.push(r.url);
    const focused = focusWebText(r.text || '', topic);
    const extracted = extractFacts(focused, r.url);
    facts.push(...extracted);
  }
  const deduped = [];
  const seen = new Set();
  for (const f of facts) {
    const id = `${f.key}:${f.source}`;
    if (!seen.has(id)) { seen.add(id); deduped.push(f); }
  }
  return {
    topic,
    fetchedAt: new Date().toISOString(),
    facts: deduped,
    sources,
    confidence: deduped.length > 0 ? 'medium' : 'low',
  };
}

export async function runResearchPlan(query, { search, fetch, maxSearches = 2, maxFetches = 2 } = {}) {
  if (typeof search !== 'function') throw new Error('search function required');
  if (typeof fetch !== 'function') throw new Error('fetch function required');

  const searchResult = await search(query);
  const ranked = rankSources(searchResult.results || [], query);
  const toFetch = ranked.slice(0, maxFetches);

  const fetchResults = [];
  for (const src of toFetch) {
    try {
      const res = await fetch(src.url);
      if (res && res.ok) fetchResults.push({ url: res.url || src.url, text: res.text || '' });
    } catch {}
  }

  const packet = buildEvidencePacket(query, fetchResults);
  return { packet, searchesUsed: 1, fetchesUsed: fetchResults.length };
}

// ── Glue history → packet (M37/M38) ─────────────────────────────────────────
/** Konversi history web_fetch sukses jadi evidence packet. Entry error di-skip. */
export function packetFromHistory(history = [], topic = '') {
  const fetches = history
    .filter(h => h && h.action === 'web_fetch' && !h.error && h.summary && !String(h.summary).startsWith('ERROR'))
    .map(h => ({ url: h.url || '(unknown)', text: h.summary }));
  return buildEvidencePacket(topic, fetches);
}

/** Render packet jadi teks ringkas bertopik, siap masuk prompt/jawaban. */
export function renderPacket(packet) {
  if (!packet || !Array.isArray(packet.facts) || packet.facts.length === 0) return '';
  const facts = packet.facts
    .map(f => `- ${f.key}: ${f.value}${f.unit ? ' ' + f.unit : ''} (sumber: ${f.source})`)
    .join('\n');
  const sources = [...new Set(packet.sources || [])].join(', ');
  return `Fakta terverifikasi:\n${facts}\nSumber: ${sources}`;
}

/** Jawaban riset dari evidence terstruktur; kalau gak ada fakta, pakai jalur lama. */
export function buildEvidenceFallback(instruction, history = []) {
  const rendered = renderPacket(packetFromHistory(history, instruction));
  if (!rendered) return buildResearchFallback(instruction, history);
  return `Hasil riset untuk "${instruction}":\n\n${rendered}`;
}
