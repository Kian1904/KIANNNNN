// M43 parser + safety regression.
import { planStep } from '../src/plan.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
const ask = async () => 'REASONING: delegate review\nACTION: delegate\nAGENT: agy\nTASK: review src and report findings';
const ctx = { instruction: 'delegate', fileSnapshot: '', history: [], availableTools: [], webSearchCount: 0 };
const step = await planStep(ask, ctx);
check('parses delegate action', step.action === 'delegate');
check('parses agent', step.agent === 'agy');
check('parses task', step.task === 'review src and report findings');
try { await planStep(async () => 'REASONING: x\nACTION: delegate\nTASK: missing agent', ctx); check('missing agent rejected', false); } catch { check('missing agent rejected', true); }
try { await planStep(async () => 'REASONING: x\nACTION: delegate\nAGENT: agy', ctx); check('missing task rejected', false); } catch { check('missing task rejected', true); }
console.log(`\n=== HASIL DELEGATE-PARSER: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
