/**
 * Ink renderer untuk squad view.
 * Ditulis pakai JSX + tipe. Dimuat lewat `node --import tsx`.
 * Catatan: rerender WAJIB bungkus state jadi props ({ state }) — kalau tidak,
 * React error "Objects are not valid as a React child" dan panel hilang.
 */
import { render, Box, Text } from 'ink';
import type { ReactElement } from 'react';
import type { SquadState } from './types.ts';

const ICON: Record<string, string> = { pending: '\u25CB', running: '\u27F3', done: '\u2713', error: '\u2717' };
const COLOR: Record<string, string> = { pending: 'gray', running: 'yellow', done: 'green', error: 'red' };

export function SquadView({ state }: { state: SquadState | undefined }): ReactElement {
  if (!state || !Array.isArray(state.agents)) {
    return (
      <Box paddingX={1}>
        <Text color="yellow">KIANNNNN \u00B7 menyiapkan squad...</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{`KIANNNNN  \u00B7  ${state.task || '-'}`}</Text>
      <Text>{`Wave ${state.currentWave || '-'}  \u00B7  Evidence ${state.evidence || 0}`}</Text>
      {state.agents.map((agent) => (
        <Text key={String(agent.id)} color={COLOR[agent.status] || 'white'}>
          {` ${ICON[agent.status] || '?'} ${String(agent.role).padEnd(14)} ${agent.status}${agent.error ? ` \u2014 ${agent.error}` : ''}`}
        </Text>
      ))}
    </Box>
  );
}

export interface InkSquadApi {
  rerender(nextState: SquadState): void;
  unmount(): void;
  waitUntilExit(): Promise<void>;
}

export function startInkSquadUi(
  state: SquadState,
  opts?: { _renderImpl?: (node: ReactElement) => any },
): InkSquadApi {
  const doRender = opts?._renderImpl || render;
  const instance = doRender(<SquadView state={state} />);
  return {
    rerender(nextState: SquadState) {
      instance.rerender(<SquadView state={nextState} />);
    },
    unmount() {
      instance.unmount();
    },
    waitUntilExit: instance.waitUntilExit,
  };
}
