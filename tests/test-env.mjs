// M46 RED: env resolver prefix K_ + fallback deprecated K_SROUTER_.
import { readEnv, readEnvInt, readEnvFlag } from '../src/env.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

check('K_ kebaca', readEnv('UI', { env: { K_UI: 'ink' } }) === 'ink');
check('fallback K_SROUTER_ masih jalan', readEnv('UI', { env: { K_SROUTER_UI: 'ink' } }) === 'ink');
check('K_ menang saat dua-duanya ada', readEnv('UI', { env: { K_UI: 'plain', K_SROUTER_UI: 'ink' } }) === 'plain');
check('kosong -> undefined', readEnv('UI', { env: {} }) === undefined);
check('K_ kosong string dianggap absen', readEnv('UI', { env: { K_UI: '', K_SROUTER_UI: 'ink' } }) === 'ink');
check('readEnvInt parse', readEnvInt('MAX_FETCH', 3, { env: { K_MAX_FETCH: '7' } }) === 7);
check('readEnvInt fallback', readEnvInt('MAX_FETCH', 3, { env: {} }) === 3);
check('readEnvInt angka invalid -> fallback', readEnvInt('MAX_FETCH', 3, { env: { K_MAX_FETCH: 'abc' } }) === 3);
check('readEnvFlag 1', readEnvFlag('AUTOROUTE', { env: { K_AUTOROUTE: '1' } }) === true);
check('readEnvFlag legacy', readEnvFlag('AUTOROUTE', { env: { K_SROUTER_AUTOROUTE: '1' } }) === true);
check('readEnvFlag mati default', readEnvFlag('AUTOROUTE', { env: {} }) === false);

console.log(`\n=== HASIL ENV: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
