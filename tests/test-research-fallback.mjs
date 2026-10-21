// M36 regression: provider failure/LLM fallback tetap menjawab dari evidence.
import { buildResearchFallback } from '../src/web-fetch.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
const history = [{ action: 'web_fetch', url: 'https://wttr.in/Jakarta', summary: 'temp_C: 32\nFeelsLikeC: 35\nhumidity: 52\nweatherDesc: Smoky haze\nwindspeedKmph: 6' }];
const answer = buildResearchFallback('cek cuaca Jakarta sekarang', history);
check('fallback tidak bilang data kosong', !/belum tersedia|tidak dapat|tidak bisa/i.test(answer));
check('fallback memuat suhu', answer.includes('32'));
check('fallback memuat kondisi', /Smoky haze/i.test(answer));
check('fallback memuat kelembapan', answer.includes('52'));
check('fallback menyebut sumber', answer.includes('wttr.in'));
console.log(`\n=== HASIL RESEARCH-FALLBACK: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
