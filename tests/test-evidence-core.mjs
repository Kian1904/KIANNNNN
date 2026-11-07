// Core boundary: evidence mapping must not require the 1,000-line task loop.
import { evidenceForContract } from '../src/core/evidence.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const contract = {
  acceptance: [
    { id: 'baseline', source: 'baseline', text: 'file read back' },
    { id: 'test', source: 'verification', text: 'test must pass' },
  ],
};

const result = evidenceForContract([
  { action: 'edit', verified: true },
  { action: 'bash', verified: true, result: { code: 0 } },
], contract);

check('returns one result per criterion', result.length === 2);
check('verified edit satisfies baseline', result[0]?.status === 'completed');
check('verified bash satisfies test', result[1]?.status === 'completed');

console.log(`\n=== HASIL EVIDENCE-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
