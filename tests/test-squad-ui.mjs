// M45 event-driven squad UI state + plain fallback.
import { createSquadUiState, applySquadEvent, renderPlainSquad } from '../src/squad-ui.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
const state = createSquadUiState({ task: 'riset lalu implement', waves: [[{ id: 1, role: 'researcher' }], [{ id: 2, role: 'coder', dependsOn: 1 }]] });
check('initial agents pending', state.agents[0].status === 'pending' && state.agents[1].status === 'pending');
applySquadEvent(state, { type: 'wave_start', wave: 1 });
applySquadEvent(state, { type: 'agent_start', id: 1, role: 'researcher' });
applySquadEvent(state, { type: 'agent_done', id: 1, summary: 'riset selesai', evidence: 2 });
check('events update researcher', state.agents[0].status === 'done' && state.agents[0].evidence === 2);
check('wave status updated', state.currentWave === 1);
applySquadEvent(state, { type: 'agent_error', id: 2, error: 'test gagal' });
check('error is visible in state', state.agents[1].status === 'error' && state.agents[1].error === 'test gagal');
const plain = renderPlainSquad(state);
check('plain renderer includes task and roles', plain.includes('riset lalu implement') && plain.includes('researcher') && plain.includes('coder'));
check('plain renderer includes error', plain.includes('test gagal'));
console.log(`\n=== HASIL SQUAD-UI: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
