import { executeMcp } from '../src/core/execution/mcp.js';
import { executeSearch, executeFetch } from '../src/core/execution/web.js';
import { executeRead, executeListDir } from '../src/core/execution/read.js';
import { executeRemember } from '../src/core/execution/memory.js';

// Boundary test helpers are dependency-injected; no real network or DB required.
let pass = 0; let fail = 0;
const check = (label, ok) => ok ? (pass++, console.log(`PASS ${label}`)) : (fail++, console.log(`FAIL ${label}`));
let remembered;
check('remember boundary delegates persistence', executeRemember('k', 'v', 'ctx', { saveDecision: x => { remembered = x; } }).key === 'k' && remembered.value === 'v');
check('mcp boundary delegates tool call', await executeMcp('tool', { a: 1 }, [], { callTool: async (...args) => args.join('|') }) === 'tool|[object Object]|');
check('search boundary delegates search', (await executeSearch('q', { searchWeb: async q => ({ q }) })).q === 'q');
check('fetch boundary delegates fetch', (await executeFetch('https://x.test', { fetchWebPage: async url => ({ url }) })).url === 'https://x.test');
const read = executeRead('x', 1, 1, { readFileRange: () => ({ ok: true, content: 'x', start: 1, end: 1, totalLines: 1 }) });
check('read boundary available in execution catalog', read.content === 'x');
check('list boundary available in execution catalog', executeListDir('.', { listDirSafe: () => 'ok' }).listing === 'ok');
console.log(`=== HASIL EXECUTION-BOUNDARIES: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
