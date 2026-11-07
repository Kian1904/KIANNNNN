import { evaluateCompletion } from '../src/core/completion-gate.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => condition ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));
const base = {
  history: [{ action: 'edit', verified: true }],
  contract: { acceptance: [{ id: 'a', text: 'file', source: 'baseline' }] },
  evidence: [{ id: 'a', status: 'completed', evidence: 'file verified' }],
  review: { verdict: 'approve', findings: [], verifiedActions: 1, totalActions: 1 },
  summary: 'selesai',
  checklist: null,
  testResult: null,
};

check('approved when all gates pass', evaluateCompletion(base).approved === true);
check('rejects empty summary', evaluateCompletion({ ...base, summary: '' }).approved === false);
check('rejects failed history', evaluateCompletion({ ...base, history: [{ action: 'bash', verified: false, error: 'fail' }] }).approved === false);
check('rejects pending evidence', evaluateCompletion({ ...base, evidence: [{ id: 'a', status: 'pending' }] }).approved === false);
check('rejects review blocker', evaluateCompletion({ ...base, review: { verdict: 'reject', findings: [{ severity: 'BLOCKER' }] } }).approved === false);
check('rejects failed required test', evaluateCompletion({ ...base, testResult: { required: true, passed: false, summary: '1 fail' } }).approved === false);

console.log(`\n=== HASIL COMPLETION-GATE-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
