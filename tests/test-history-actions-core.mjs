import { historyError, historyCondition, historyNote } from '../src/core/history-actions.js';
let pass=0, fail=0; const check=(l,c)=>c?(pass++,console.log(`  PASS ${l}`)):(fail++,console.log(`  FAIL ${l}`));
check('error preserves action', historyError('bash','bad').action==='bash'&&historyError('bash','bad').verified===false);
check('condition shape', historyCondition('stop').action==='user_condition');
check('note shape', historyNote('x').action==='note'&&historyNote('x').text==='x');
console.log(`\n=== HASIL HISTORY-ACTIONS-CORE: ${pass} pass, ${fail} fail ===`); if(fail)process.exit(1);
