/**
 * Shell.tsx — ink shell utama KIANNNNN (M58).
 *
 * Menggantikan readline REPL dengan UI ink: header status, output area
 * (scrollable), input box, dan status bar. Dipakai kalau K_UI=ink + TTY.
 *
 * Desain: shell ini "dumb" — dia cuma render state + kirim input ke caller.
 * Semua logic (routing, approval, task) tetap di repl.js. Ini menjaga
 * boundary: TUI = daun, core = akar.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp, render as inkRender } from 'ink';

export interface ShellLine {
  id: number;
  kind: 'user' | 'assistant' | 'system' | 'info' | 'error' | 'done' | 'block';
  text: string;
}

export interface ShellState {
  model: string;
  thread: number | string;
  mode: string;
  provider: string;
  lines: ShellLine[];
  busy: boolean;
  status: string;
}

export interface ShellApi {
  pushLine(line: Omit<ShellLine, 'id'>): void;
  setState(patch: Partial<ShellState>): void;
  setBusy(busy: boolean): void;
  setStatus(status: string): void;
  clear(): void;
  waitUntilExit(): Promise<void>;
}

const KIND_COLOR: Record<string, string> = {
  user: 'cyan',
  assistant: 'white',
  system: 'magenta',
  info: 'blue',
  error: 'red',
  done: 'green',
  block: 'gray',
};

const KIND_PREFIX: Record<string, string> = {
  user: '> ',
  assistant: '',
  system: '· ',
  info: '· ',
  error: '! ',
  done: '✓ ',
  block: '  ',
};

/** Potong baris lama biar output gak meledak (jaga RAM + render). */
const MAX_LINES = 200;

export function Shell({
  initialState,
  onSubmit,
  onExit,
  apiRef,
}: {
  initialState: ShellState;
  onSubmit: (input: string) => void;
  onExit: () => void;
  apiRef: { current: ShellApi | null };
}): React.ReactElement {
  const [state, setState] = useState<ShellState>(initialState);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const { exit } = useApp();
  const nextId = useRef(1);

  // Expose API ke caller (repl.js) — biar bisa push output dari luar.
  useEffect(() => {
    apiRef.current = {
      pushLine(line) {
        setState((s) => {
          const lines = [...s.lines, { ...line, id: nextId.current++ }];
          return { ...s, lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines };
        });
      },
      setState(patch) {
        setState((s) => ({ ...s, ...patch }));
      },
      setBusy(busy) {
        setState((s) => ({ ...s, busy }));
      },
      setStatus(status) {
        setState((s) => ({ ...s, status }));
      },
      clear() {
        setState((s) => ({ ...s, lines: [] }));
      },
      waitUntilExit: () => Promise.resolve(),
    };
    return () => { apiRef.current = null; };
  }, [apiRef]);

  useInput((ch, key) => {
    if (state.busy) return; // input dikunci saat agent kerja

    if (key.return) {
      const value = input.trim();
      setInput('');
      setCursor(0);
      if (value) onSubmit(value);
      return;
    }
    if (key.ctrl && ch === 'c') {
      onExit();
      exit();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (key.tab) {
      // autocomplete sederhana: kalau mulai '/', lengkapi ke command pertama yang cocok
      if (input.startsWith('/')) {
        const cmds = ['/help', '/exit', '/model', '/usage', '/auth', '/connect', '/rollback', '/route', '/squad', '/clear'];
        const match = cmds.find((c) => c.startsWith(input) && c !== input);
        if (match) setInput(match);
      }
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      setInput((v) => v + ch);
    }
  });

  const visible = state.lines.slice(-MAX_LINES);

  return (
    <Box flexDirection="column">
      {/* Header — ringkas, biar gak wrap di terminal sempit */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">KIANNNNN</Text>
        <Text color="gray"> · </Text>
        <Text color="yellow">{state.model}</Text>
        <Text color="gray"> · #{state.thread} · </Text>
        <Text color="green">{state.mode}</Text>
      </Box>

      {/* Output area */}
      <Box flexDirection="column" paddingX={1} minHeight={6}>
        {visible.length === 0 ? (
          <Text color="gray">(belum ada output — ketik instruksi, /help untuk command)</Text>
        ) : (
          visible.map((line) => (
            <Text key={line.id} color={KIND_COLOR[line.kind] || 'white'}>
              {KIND_PREFIX[line.kind] || ''}{line.text}
            </Text>
          ))
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor={state.busy ? 'yellow' : 'gray'} paddingX={1}>
        {state.busy ? (
          <Text color="yellow">⟳ {state.status || 'bekerja...'}</Text>
        ) : (
          <>
            <Text color="cyan">{'> '}</Text>
            <Text>{input}</Text>
            <Text color="gray">▌</Text>
          </>
        )}
      </Box>

      {/* Status bar */}
      <Box paddingX={1}>
        <Text color="gray">
          {state.busy
            ? `input dikunci${state.provider ? ' · ' + state.provider : ''}`
            : `Enter kirim · Tab lengkapi · Ctrl+C keluar${state.provider ? ' · ' + state.provider : ''}`}
        </Text>
      </Box>
    </Box>
  );
}

export interface StartShellResult {
  api: ShellApi;
  waitUntilExit: () => Promise<void>;
}

/**
 * Jalankan shell ink. Return API buat push output + tunggu sampai exit.
 *
 * Catatan: apiRef di-set di useEffect (setelah render pertama). Karena itu
 * kita pakai proxy yang antre panggilan sampai api asli siap — biar caller
 * bisa langsung pushLine tanpa nunggu.
 */
export function startShell(
  initialState: ShellState,
  onSubmit: (input: string) => void,
  onExit: () => void,
  renderImpl?: (node: React.ReactElement) => any,
): StartShellResult {
  const apiRef: { current: ShellApi | null } = { current: null };
  const queue: Array<(api: ShellApi) => void> = [];

  const proxy: ShellApi = {
    pushLine: (l) => apiRef.current ? apiRef.current.pushLine(l) : queue.push((a) => a.pushLine(l)),
    setState: (p) => apiRef.current ? apiRef.current.setState(p) : queue.push((a) => a.setState(p)),
    setBusy: (b) => apiRef.current ? apiRef.current.setBusy(b) : queue.push((a) => a.setBusy(b)),
    setStatus: (s) => apiRef.current ? apiRef.current.setStatus(s) : queue.push((a) => a.setStatus(s)),
    clear: () => apiRef.current ? apiRef.current.clear() : queue.push((a) => a.clear()),
    waitUntilExit: () => Promise.resolve(),
  };

  const doRender = renderImpl || inkRender;
  const instance = doRender(
    <Shell initialState={initialState} onSubmit={onSubmit} onExit={onExit} apiRef={apiRef} />,
  );

  // Flush antrean begitu api asli siap (setelah render pertama).
  const flush = () => {
    if (apiRef.current) {
      for (const fn of queue) fn(apiRef.current);
      queue.length = 0;
    } else {
      setTimeout(flush, 10);
    }
  };
  setTimeout(flush, 0);

  return {
    api: proxy,
    waitUntilExit: () => instance.waitUntilExit(),
  };
}
