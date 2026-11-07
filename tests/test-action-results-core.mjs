import {
  buildEditHistory,
  buildDestructiveHistory,
  buildWebHistory,
  buildMcpHistory,
  buildChatHistory,
  buildRememberHistory,
} from '../src/core/action-results.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => condition ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));

check('edit success maps verification', buildEditHistory('a.js', true, 'ok').verified === true);
check('edit failure maps reason', buildEditHistory('a.js', false, 'lint').error === 'lint');
check('destructive keeps destination', buildDestructiveHistory('rename', 'a', 'b', true).dest === 'b');
check('destructive success is verified', buildDestructiveHistory('delete', 'a', undefined, true).verified === true);
check('web result maps summary', buildWebHistory('web_search', 'q', 'summary', true).summary === 'summary');
check('web failure maps error', buildWebHistory('web_fetch', 'u', '', false, 'network').error === 'network');
check('mcp result is wrapped by caller', buildMcpHistory('tool', 'result').result === 'result');
check('chat result keeps reply', buildChatHistory('hello').reply === 'hello');
check('remember result keeps key/value', buildRememberHistory('k', 'v').value === 'v');

console.log(`\n=== HASIL ACTION-RESULTS-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
