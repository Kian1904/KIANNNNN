// M45/M46: optional Ink renderer. Loaded only when K_UI=ink on a TTY.
// PENTING: komponen menerima props `state`, jadi rerender wajib dikasih
// { state } — bukan state mentah (itu bikin React marah "Objects are not valid
// as a React child" dan panel-nya ilang).
import React from 'react';
import { render, Box, Text } from 'ink';

const ICON = { pending: '○', running: '⟳', done: '✓', error: '✗' };
const COLOR = { pending: 'gray', running: 'yellow', done: 'green', error: 'red' };

export function SquadView({ state }) {
  if (!state || !Array.isArray(state.agents)) {
    return React.createElement(Box, { paddingX: 1 },
      React.createElement(Text, { color: 'yellow' }, 'KIANNNNN · menyiapkan squad...'));
  }
  return React.createElement(Box, { flexDirection: 'column', borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    React.createElement(Text, { bold: true, color: 'cyan' }, `KIANNNNN  ·  ${state.task || '-'}`),
    React.createElement(Text, null, `Wave ${state.currentWave || '-'}  ·  Evidence ${state.evidence || 0}`),
    ...state.agents.map(agent => React.createElement(Text, { key: String(agent.id), color: COLOR[agent.status] || 'white' },
      ` ${ICON[agent.status] || '?'} ${String(agent.role).padEnd(14)} ${agent.status}${agent.error ? ` — ${agent.error}` : ''}`
    ))
  );
}

export function startInkSquadUi(state) {
  const doRender = arguments[1]?._renderImpl || render;
  const instance = doRender(React.createElement(SquadView, { state }));
  return {
    // Kontrak: rerender(state) — dibungkus lagi jadi props biar aman.
    rerender(nextState) {
      instance.rerender(React.createElement(SquadView, { state: nextState }));
    },
    unmount() {
      instance.unmount();
    },
    waitUntilExit: instance.waitUntilExit,
  };
}
