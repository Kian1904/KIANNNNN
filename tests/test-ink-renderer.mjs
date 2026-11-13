// M46 RED: kontrak renderer Ink — rerender harus bungkus state jadi props.
// Regresi nyata: dulu rerender(state) mentah → React error
// "Objects are not valid as a React child" dan panel ilang.
// Versi TSX: perilaku diuji langsung lewat spy, bukan regex source yang rapuh.
import { SquadView, startInkSquadUi } from '../src/renderer/SquadView.tsx';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const state = {
  task: 'tes render',
  currentWave: 2,
  evidence: 3,
  agents: [
    { id: 1, role: 'researcher', status: 'done', error: '' },
    { id: 2, role: 'coder', status: 'error', error: 'test gagal' },
  ],
};

check('SquadView itu function component', typeof SquadView === 'function');
{
  const el = SquadView({ state });
  check('SquadView balikin element valid', el && typeof el === 'object' && el.type != null);
  check('SquadView gak throw tanpa state', Boolean(SquadView({ state: undefined })));
}
{
  const fake = { rerender() {}, unmount() {}, waitUntilExit() {} };
  const api = startInkSquadUi(state, { _renderImpl: () => fake });
  check('api punya rerender', typeof api.rerender === 'function');
  check('api punya unmount', typeof api.unmount === 'function');
  api.rerender(state);
  check('rerender gak throw dengan state valid', true);
  api.unmount();
  check('unmount gak throw', true);
}
{
  let received = null;
  const fake = { rerender(el) { received = el; }, unmount() {}, waitUntilExit() {} };
  const api = startInkSquadUi(state, { _renderImpl: () => fake });
  const next = { ...state, currentWave: 5 };
  api.rerender(next);
  const wrapped = received && received.props && received.props.state === next;
  check('rerender membungkus state jadi props {state}', Boolean(wrapped));
  check('tidak meneruskan state mentah', received !== next);
}

console.log(`\n=== HASIL INK-RENDERER: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
