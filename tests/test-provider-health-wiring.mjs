// M39 wiring: 429 membuka circuit dan provider cooldown dilewati cascade.
import { raceProviders, providerHealth } from '../src/providers.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

let p1Calls = 0;
const p1 = {
  key: 'flaky',
  name: 'FLAKY',
  fn: async () => { p1Calls++; throw new Error('groq API error 429: {"error":{"message":"Rate limit reached"}}'); },
};
const p2 = { key: 'healthy', name: 'HEALTHY', fn: async () => 'jawaban-ok' };

// Panggilan pertama: p1 gagal 429, p2 menang.
const first = await raceProviders([p1, p2], 'sys', 'usr');
check('cascade tetap sukses lewat provider berikutnya', first === 'jawaban-ok');
check('429 membuka circuit p1', providerHealth.isAvailable('flaky') === false);
check('provider sehat tetap tersedia', providerHealth.isAvailable('healthy') === true);

// Panggilan kedua: p1 sudah cooldown — jangan dipanggil lagi.
const callsBefore = p1Calls;
const second = await raceProviders([p1, p2], 'sys', 'usr');
check('provider cooldown dilewati tanpa dipanggil', p1Calls === callsBefore && second === 'jawaban-ok');

// recordSuccess menutup circuit.
providerHealth.recordSuccess('flaky');
check('recordSuccess menutup circuit', providerHealth.isAvailable('flaky') === true);

console.log(`\n=== HASIL PROVIDER-HEALTH-WIRING: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
