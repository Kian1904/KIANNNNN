// M34 regression: halaman panjang + JSON weather harus jadi evidence ringkas.
import { focusWebText, buildWebEvidenceSummary } from '../src/web-fetch.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
const raw = `Navigasi BMKG\nTentang BMKG\nKota Jakarta Pusat\nCerah Berawan\n25–31 °C\n70–90%\nKota Jakarta Selatan\nHujan Ringan\n24–30 °C\n75–95%\nFooter`;
const focused = focusWebText(raw, 'cuaca Jakarta hari ini');
check('tetap menyimpan kota', focused.includes('Jakarta Pusat') && focused.includes('Jakarta Selatan'));
check('tetap menyimpan kondisi', focused.includes('Cerah Berawan') && focused.includes('Hujan Ringan'));
check('tetap menyimpan suhu/kelembapan', focused.includes('25–31 °C') && focused.includes('70–90%'));
check('tidak menyalin navigasi panjang', !focused.includes('Tentang BMKG'));
check('ukuran bounded', focused.length <= 12000);
const json = JSON.stringify({ current_condition: [{ temp_C: '32', humidity: '52', FeelsLikeC: '35', weatherDesc: [{ value: 'Smoky haze' }], windspeedKmph: '6' }] });
const jsonFocus = focusWebText(json, 'cuaca Jakarta sekarang');
check('JSON weather mempertahankan suhu', /32/.test(jsonFocus));
check('JSON weather mempertahankan kondisi', /Smoky haze/i.test(jsonFocus));
const evidence = buildWebEvidenceSummary([{ action: 'web_fetch', url: 'https://weather.test', summary: jsonFocus }]);
check('fallback evidence bukan copy-paste panjang', evidence.length < 1000 && /32|Smoky haze/.test(evidence));
console.log(`\n=== HASIL WEB-FOCUS: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
