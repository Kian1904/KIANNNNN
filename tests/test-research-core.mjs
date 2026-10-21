// M37-M41 RED: research engine, evidence schema, provider health, budget, compaction.
import { buildEvidencePacket, rankSources, runResearchPlan, packetFromHistory, renderPacket, buildEvidenceFallback } from '../src/research-engine.js';
import { createProviderHealth } from '../src/provider-health.js';
import { createTaskBudget } from '../src/task-budget.js';
import { compactResearchContext } from '../src/research-context.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const sources = [
  { title: 'Weather blog', url: 'https://example.com/weather', snippet: 'Jakarta 32 C' },
  { title: 'BMKG Jakarta', url: 'https://www.bmkg.go.id/cuaca/prakiraan-cuaca/31', snippet: 'Prakiraan DKI Jakarta' },
];
const ranked = rankSources(sources, 'cuaca Jakarta hari ini');
check('official source ranks first', ranked[0].url.includes('bmkg.go.id'));

const packet = buildEvidencePacket('cuaca Jakarta sekarang', [{
  url: 'https://wttr.in/Jakarta',
  text: 'temp_C: 32\nhumidity: 52\nweatherDesc: Smoky haze',
  fetchedAt: '2026-10-21T00:00:00.000Z',
}]);
check('packet has topic and sources', packet.topic && packet.sources.length === 1);
check('packet has extracted facts', packet.facts.some(f => f.key === 'temperature'));
check('packet preserves provenance', packet.facts.every(f => f.source === 'https://wttr.in/Jakarta'));

const health = createProviderHealth({ cooldownMs: 1000 });
health.recordFailure('groq', { status: 429, retryAfter: 60 });
check('429 opens circuit', health.isAvailable('groq') === false);
check('other provider remains available', health.isAvailable('gemini') === true);
check('failure state has no secret', !JSON.stringify(health.snapshot()).includes('sk-'));

const budget = createTaskBudget({ maxSteps: 2, maxSearches: 1, maxFetches: 1 });
check('step budget allows first two', budget.consume('step') && budget.consume('step'));
check('step budget blocks third', budget.consume('step') === false);
check('search budget blocks second', budget.consume('search') && budget.consume('search') === false);
check('budget exposes remaining', budget.snapshot().remaining.steps === 0);

const compact = compactResearchContext(packet, { maxChars: 500 });
check('compact context bounded', compact.length <= 500);
check('compact context keeps facts', /32|52|Smoky haze/.test(compact));

const calls = [];
const result = await runResearchPlan('cuaca Jakarta', {
  search: async q => { calls.push(`search:${q}`); return { results: sources }; },
  fetch: async url => { calls.push(`fetch:${url}`); return { ok: true, url, text: 'temp_C: 32\nhumidity: 52' }; },
  maxSearches: 1,
  maxFetches: 1,
});
check('engine performs search then fetch', calls.length >= 2 && calls[0].startsWith('search:') && calls.some(c => c.startsWith('fetch:')));
check('engine returns evidence packet', result.packet.facts.length > 0 && result.packet.sources.length > 0);

// Glue: history → packet → render → fallback berbasis fakta (M37/M38).
const hist = [{ action: 'web_fetch', url: 'https://wttr.in/Jakarta', summary: 'temp_C: 32\nhumidity: 52\nweatherDesc: Smoky haze' }];
const histPacket = packetFromHistory(hist, 'cuaca Jakarta sekarang');
check('packetFromHistory sukses dari history fetch', histPacket.facts.some(f => f.key === 'temperature' && f.value === '32'));
check('packetFromHistory abaikan entry error', packetFromHistory([{ action: 'web_fetch', url: 'x', summary: 'ERROR: timeout', error: 'timeout' }], 'q').facts.length === 0);
const rendered = renderPacket(histPacket);
check('renderPacket berisi fakta + sumber', /32/.test(rendered) && /wttr\.in/.test(rendered));
const evidenceFallback = buildEvidenceFallback('cek cuaca Jakarta sekarang', hist);
check('evidence fallback pakai fakta bukan teks kosong', /32/.test(evidenceFallback) && /Smoky haze/i.test(evidenceFallback) && !/belum tersedia/i.test(evidenceFallback));
check('evidence fallback tanpa fakta jatuh ke jalur lama', /belum tersedia/.test(buildEvidenceFallback('q', [])));

console.log(`\n=== HASIL RESEARCH-CORE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
