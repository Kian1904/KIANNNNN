import { formatReadResult, normalizeListTarget } from '../src/core/fs-actions.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const read = formatReadResult('src/app.js', {
  ok: true, content: ' 1|one\n 2|two', totalLines: 5, start: 1, end: 2,
});
check('read keeps content', read.content.includes('1|one'));
check('read produces ranged label', read.label === 'src/app.js (baris 1-2 dari 5)');
check('read preserves failed target label', formatReadResult('missing.js', { ok: false, content: 'gone', totalLines: 0, start: 0, end: 0 }).label === 'missing.js');
check('list target defaults to current directory', normalizeListTarget() === '.');
check('list target trims whitespace', normalizeListTarget('  src  ') === 'src');

console.log(`\n=== HASIL FS-ACTION-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
