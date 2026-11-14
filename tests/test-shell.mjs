// M58: test ink shell (UI utama) — render + API + redirect output.
import { Shell, startShell } from '../src/renderer/Shell.tsx';
import { setUiSink, print, printBlock, getUiSink } from '../src/ui.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

// ── 1. Shell component ───────────────────────────────────────────────────────
check('Shell itu function component', typeof Shell === 'function');

const baseState = {
  model: 'xkiro/mistral-large',
  thread: 1,
  mode: 'SAFE',
  provider: 'XKIRO',
  lines: [],
  busy: false,
  status: '',
};

// Catatan: JANGAN panggil Shell() langsung — dia pakai hooks (useState/useInput),
// yang cuma boleh jalan di dalam React render. Test render nyata ada di bagian 2
// (via startShell dengan renderImpl palsu) + verifikasi PTY manual.

// ── 2. startShell: API tersedia + antrean ────────────────────────────────────
{
  const pushed = [];
  const fakeInstance = { waitUntilExit: () => Promise.resolve(), unmount() {} };
  const fakeRender = (node) => {
    // Simulasi: panggil apiRef setelah render (seperti useEffect)
    const apiRef = node.props.apiRef;
    setTimeout(() => {
      apiRef.current = {
        pushLine: (l) => pushed.push(l),
        setState: () => {},
        setBusy: () => {},
        setStatus: () => {},
        clear: () => {},
        waitUntilExit: () => Promise.resolve(),
      };
    }, 0);
    return fakeInstance;
  };

  const result = startShell(baseState, () => {}, () => {}, fakeRender);
  check('startShell balikin api', result.api && typeof result.api.pushLine === 'function');
  check('startShell balikin waitUntilExit', typeof result.waitUntilExit === 'function');

  // pushLine sebelum api siap → harus masuk antrean, lalu terkirim
  result.api.pushLine({ kind: 'info', text: 'tes antrean' });
  await new Promise((r) => setTimeout(r, 30));
  check('pushLine terkirim setelah api siap', pushed.length === 1 && pushed[0].text === 'tes antrean');
}

// ── 3. UI sink: print/printBlock redirect ────────────────────────────────────
{
  const captured = [];
  setUiSink((kind, text) => captured.push({ kind, text }));
  check('getUiSink balikin fungsi', typeof getUiSink() === 'function');

  print('info', 'pesan info');
  print('error', 'pesan error');
  print('done', 'pesan done');
  printBlock('blok teks');

  check('print info → kind info', captured.some((c) => c.kind === 'info' && c.text === 'pesan info'));
  check('print error → kind error', captured.some((c) => c.kind === 'error' && c.text === 'pesan error'));
  check('print done → kind done', captured.some((c) => c.kind === 'done' && c.text === 'pesan done'));
  check('printBlock → kind block', captured.some((c) => c.kind === 'block' && c.text === 'blok teks'));

  // Reset sink → perilaku lama (console.log) kembali
  setUiSink(null);
  check('setUiSink(null) reset', getUiSink() === null);
}

// ── 4. shouldUseInk: butuh K_UI=ink + TTY ────────────────────────────────────
{
  const { shouldUseInk } = await import('../src/squad-ui.js');
  check('tanpa K_UI → false', shouldUseInk({ env: {}, stdout: { isTTY: true } }) === false);
  check('K_UI=ink tanpa TTY → false', shouldUseInk({ env: { K_UI: 'ink' }, stdout: { isTTY: false } }) === false);
  check('K_UI=ink + TTY → true', shouldUseInk({ env: { K_UI: 'ink' }, stdout: { isTTY: true } }) === true);
  check('K_UI=plain → false', shouldUseInk({ env: { K_UI: 'plain' }, stdout: { isTTY: true } }) === false);
}

console.log(`\n=== HASIL SHELL: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
