import { createTaskRuntimeConfig } from '../src/core/task-config.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const config = createTaskRuntimeConfig({
  agentConfig: { name: 'coder', maxLoops: 7, actions: ['read', 'bash'], mcpTools: [] },
  agentMd: null,
  availableTools: [{ name: 'safe' }, { name: 'other' }],
  contract: { acceptance: [{ id: 'a', text: 'test', source: 'verification' }], risk: 'low' },
  env: { MAX_SEARCH: '4', MAX_FETCH: '5', MAX_LOOPS: '2' },
});

check('uses agent max loops', config.maxLoops === 7);
check('filters MCP tools', config.toolsForAgent.length === 0);
check('preserves allowed actions', config.allowedActions.join(',') === 'read,bash');
check('creates budget with configured limits', config.budget.snapshot().limits.searches === 4 && config.budget.snapshot().limits.fetches === 5);
check('injects contract into prompt', config.systemPromptOverride.includes('KONTRAK TASK'));

console.log(`\n=== HASIL TASK-CONFIG-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
