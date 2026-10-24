// M45: optional Ink renderer. Loaded only when K_SROUTER_UI=ink on a TTY.
import React from 'react';
import { render, Box, Text } from 'ink';

const ICON = { pending: '○', running: '⟳', done: '✓', error: '✗' };
const COLOR = { pending: 'gray', running: 'yellow', done: 'green', error: 'red' };

function SquadView({ state }) {
  return React.createElement(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    React.createElement(Text, { bold: true, color: 'cyan' }, `KIANNNNN  ·  ${state.task}`),
    React.createElement(Text, null, `Wave ${state.currentWave || '-'}  ·  Evidence ${state.evidence}`),
    ...state.agents.map(agent => React.createElement(Text, { key: String(agent.id), color: COLOR[agent.status] },
      ` ${ICON[agent.status] || '?'} ${agent.role.padEnd(14)} ${agent.status}${agent.error ? ` — ${agent.error}` : ''}`
    ))
  );
}

export function startInkSquadUi(state) {
  return render(React.createElement(SquadView, { state }));
}

export { SquadView };
