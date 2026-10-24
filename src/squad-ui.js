// M45: event-driven squad UI state + plain renderer.
// UI tidak memiliki authority atas execution/safety; hanya membaca state/events.

export function createSquadUiState({ task = '', waves = [] } = {}) {
  const agents = waves.flat().map(item => ({
    id: item.id,
    role: item.role,
    dependsOn: item.dependsOn ?? null,
    status: 'pending',
    summary: '',
    error: '',
    evidence: 0,
  }));
  return { task, waves, agents, currentWave: 0, evidence: 0, events: [] };
}

export function applySquadEvent(state, event = {}) {
  state.events.push({ ...event });
  if (event.type === 'wave_start') state.currentWave = event.wave;
  const agent = state.agents.find(a => a.id === event.id);
  if (!agent) return state;
  if (event.type === 'agent_start') agent.status = 'running';
  if (event.type === 'agent_done') {
    agent.status = 'done';
    agent.summary = event.summary || '';
    agent.evidence = Number(event.evidence) || 0;
    state.evidence += agent.evidence;
  }
  if (event.type === 'agent_error') {
    agent.status = 'error';
    agent.error = event.error || 'unknown error';
  }
  return state;
}

const ICON = { pending: '○', running: '⟳', done: '✓', error: '✗' };
export function renderPlainSquad(state) {
  const lines = [`SQUAD  ${state.task}`, `Wave: ${state.currentWave || '-'}  Evidence: ${state.evidence}`];
  for (const agent of state.agents) {
    const extra = agent.error || agent.summary;
    lines.push(`  ${ICON[agent.status] || '?'} ${agent.role} [${agent.status}]${extra ? ` — ${extra}` : ''}`);
  }
  return lines.join('\n');
}

export function shouldUseInk({ env = process.env, stdout = process.stdout } = {}) {
  return env.K_SROUTER_UI === 'ink' && Boolean(stdout?.isTTY);
}
