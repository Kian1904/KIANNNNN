import { buildMutationPlan, buildMutationHistory } from '../src/core/file-mutation.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const plan = buildMutationPlan({ action: 'append', target: 'a.txt', before: 'one', content: ' two' });
check('append plan computes final content', plan.finalContent === 'one two');
check('append plan preserves old content', plan.before === 'one');
check('write plan uses supplied content', buildMutationPlan({ action: 'write', target: 'b.txt', before: '', content: 'x' }).finalContent === 'x');
check('mkdir plan has no file content', buildMutationPlan({ action: 'mkdir', target: 'dir', before: '', content: 'ignored' }).finalContent === null);

const history = buildMutationHistory('append', 'a.txt', { ok: true }, { ok: true, reason: 'isi file cocok setelah edit' });
check('history records operation', history.action === 'append' && history.target === 'a.txt');
check('history records verification', history.verified === true);

console.log(`\n=== HASIL FILE-MUTATION-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
