import { buildDelegateRequest, buildMcpRequest, buildSearchRecord, buildFetchRecord } from '../src/core/external-actions.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => condition ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));

const delegate = buildDelegateRequest('qwen', 'inspect repo', '/workspace');
check('delegate request keeps agent/task', delegate.agent === 'qwen' && delegate.task === 'inspect repo');
check('delegate request is sandboxed', delegate.options.sandbox === true && delegate.options.cwd === '/workspace');
const mcp = buildMcpRequest('search', { q: 'x' });
check('MCP request keeps tool/args', mcp.tool === 'search' && mcp.args.q === 'x');
const search = buildSearchRecord('q', 'serper', [{ url: 'https://x', title: 'X', snippet: 's' }]);
check('search record formats source', search.summary.includes('https://x') && search.query === 'q');
const fetch = buildFetchRecord('https://x', 'body', true);
check('fetch record keeps url/body', fetch.url === 'https://x' && fetch.summary === 'body' && fetch.verified === true);

console.log(`\n=== HASIL EXTERNAL-ACTIONS-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
