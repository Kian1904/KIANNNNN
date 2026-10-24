// M44 RED: delegate result wajib punya struktur artifact/test evidence.
import { parseDelegateResult } from '../src/delegate-cli.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const parsed = parseDelegateResult(JSON.stringify({
  summary: 'implementasi selesai',
  artifacts: [{ path: 'src/a.js', action: 'modified' }],
  tests_passed: true,
  tests: [{ command: 'node --check src/a.js', exit_code: 0 }],
  changed_files: ['src/a.js'],
}), 'json');
check('structured result parses', parsed.ok);
check('artifacts preserved', parsed.artifacts.length === 1 && parsed.artifacts[0].path === 'src/a.js');
check('tests_passed preserved', parsed.tests_passed === true);
check('changed_files preserved', parsed.changed_files.includes('src/a.js'));

const weak = parseDelegateResult(JSON.stringify({ summary: 'done' }), 'json');
check('missing evidence is not verified', weak.verified === false);
check('weak result still keeps summary', weak.summary === 'done');

const invalid = parseDelegateResult(JSON.stringify({ summary: 'done', tests_passed: 'yes' }), 'json');
check('invalid tests_passed is rejected', invalid.ok === false);

console.log(`\n=== HASIL DELEGATE-STRUCTURED: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
