// M62 RED: environment intelligence — agent tau kondisi sekitar.
import {
  detectEnvironment, describeEnvironment, getFreeDisk, getNodeVersion,
} from '../src/env-intel.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

const env = detectEnvironment();
check('detect: punya os', typeof env.os === 'string' && env.os.length > 0);
check('detect: punya arch', typeof env.arch === 'string' && env.arch.length > 0);
check('detect: punya nodeVersion', typeof env.nodeVersion === 'string');
check('detect: punya cwd', typeof env.cwd === 'string');
check('detect: punya freeDisk', typeof env.freeDisk === 'number');
check('detect: punya platform', typeof env.platform === 'string');

const desc = describeEnvironment(env);
check('describe: tidak kosong', desc.trim().length > 0);
check('describe: menyebut OS', desc.includes(env.os));
check('describe: menyebut node', desc.includes(env.nodeVersion));

check('getFreeDisk: angka positif', getFreeDisk() > 0);
check('getNodeVersion: string', typeof getNodeVersion() === 'string');

console.log(`\n=== HASIL ENV-INTEL: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
