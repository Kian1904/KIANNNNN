// tests/test-agents.mjs — Verifikasi PoC multi-agent (registry, prompt, whitelist, routing).
// Written by K-sRouter

import { AGENTS, getAgent, validateAgent, composeAgentPrompt, filterToolsForAgent, KNOWN_ACTIONS } from '../src/agents.js';
import { SYSTEM_PROMPT, ACTION_FORMAT } from '../src/prompts/system.js';
import { getActiveAgent, setActiveAgent, listAgents } from '../src/orchestrator.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

console.log('\n[1] Registry & validasi');
for (const agent of listAgents()) {
  const problems = validateAgent(agent);
  check(`${agent.name} valid`, problems.length === 0, problems.join('; '));
}
check('ada minimal 3 agent (researcher/coder/reviewer)',
  ['researcher', 'coder', 'reviewer'].every(n => AGENTS[n]));
check('nama agent unik', new Set(Object.keys(AGENTS)).size === Object.keys(AGENTS).length);

console.log('\n[2] Compose prompt per agent');
const researcherPrompt = composeAgentPrompt(AGENTS.researcher, null);
check('researcher prompt memuat persona', researcherPrompt.includes('RESEARCHER'));
check('researcher prompt memuat ACTION_FORMAT', researcherPrompt.includes('ACTION: edit') && researcherPrompt.includes('ACTION: web_search'));
check('researcher prompt membatasi aksi', researcherPrompt.includes('HANYA: read, list_dir, web_search, chat, remember'));
check('researcher prompt memuat aturan search', researcherPrompt.includes('baca snippet hasilnya'));

const coderPrompt = composeAgentPrompt(AGENTS.coder, null);
check('coder prompt memuat persona', coderPrompt.includes('CODER'));
check('coder prompt TIDAK memuat aturan search (search:false)', !coderPrompt.includes('baca snippet hasilnya'));
check('coder prompt memuat AGENT.md saat diberikan', composeAgentPrompt(AGENTS.coder, 'INI AGENT MD').includes('INI AGENT MD'));
check('coder prompt TANPA AGENT.md saat null', !coderPrompt.includes('Project Instructions'));

console.log('\n[3] Filter tool MCP (whitelist)');
const fakeTools = [{ name: 'ktools_search' }, { name: 'ktools_summarize' }, { name: 'other_tool' }];
check('mcpTools=null -> semua tool lolos', filterToolsForAgent(fakeTools, null).length === 3);
check('mcpTools=[] -> tanpa tool', filterToolsForAgent(fakeTools, []).length === 0);
check('mcpTools=[ktools_search] -> subset', filterToolsForAgent(fakeTools, ['ktools_search']).map(t => t.name).join() === 'ktools_search');
check('tools non-array -> []', filterToolsForAgent(null, null).length === 0);

console.log('\n[4] Routing orchestrator');
check('default: tidak ada agent aktif', getActiveAgent() === null);
const a = setActiveAgent('coder');
check('setActiveAgent("coder") -> config coder', a && a.name === 'coder');
check('getActiveAgent() ikut berubah', getActiveAgent()?.name === 'coder');
check('setActiveAgent(null) -> generic', setActiveAgent(null) === null && getActiveAgent() === null);
let threw = false;
try { setActiveAgent('hantu'); } catch { threw = true; }
check('nama agent tak dikenal melempar error', threw);

console.log('\n[5] Backward-compat SYSTEM_PROMPT generik');
['edit', 'bash', 'read', 'list_dir', 'done', 'remember', 'mcp_call', 'web_search', 'chat']
  .forEach(action => {
    check(`SYSTEM_PROMPT memuat format ${action}`, SYSTEM_PROMPT.includes(`ACTION: ${action}`));
  });
check('ACTION_FORMAT diekspor & dipakai ulang', ACTION_FORMAT.length > 0 && SYSTEM_PROMPT.includes(ACTION_FORMAT));
check('konstitusi ter-format (bukan toString array)', SYSTEM_PROMPT.includes('PRINSIP DASAR') && !SYSTEM_PROMPT.includes('],"'));

console.log('\n[6] Batas aksi diketahui parser');
// Aksi destruktif (delete/rename/move) masuk di M21. Yang penting bukan
// jumlahnya, tapi: setiap aksi yang dibolehkan ke agent HARUS dikenali parser.
// Kalau ada yang kelewat, agent bakal "boleh" melakukan sesuatu yang parse-nya
// ditolak diam-diam.
check('KNOWN_ACTIONS: 11 aksi (8 lama + delete/rename/move)',
  KNOWN_ACTIONS.length === 11, `dapat ${KNOWN_ACTIONS.length}`);
check('aksi destruktif dikenal parser',
  ['delete', 'rename', 'move'].every(a => KNOWN_ACTIONS.includes(a)));
check('setiap aksi agent subset KNOWN_ACTIONS',
  listAgents().every(ag => ag.actions.every(x => KNOWN_ACTIONS.includes(x))));

console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
