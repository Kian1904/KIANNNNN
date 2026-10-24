// M46 RED: kontrak renderer Ink — rerender harus bungkus state jadi props.
// Ini regresi nyata: dulu rerender(state) mentah → React error
// "Objects are not valid as a React child" dan panel ilang.
import { SquadView, startInkSquadUi } from '../src/ink-squad-ui.js';
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
  // startInkSquadUi harus balikin kontrak { rerender, unmount } yang stabil.
  const fake = { rerender() {}, unmount() {}, waitUntilExit() {} };
  const api = startInkSquadUi(state, { _renderImpl: () => fake });
  check('api punya rerender', typeof api.rerender === 'function');
  check('api punya unmount', typeof api.unmount === 'function');
  let called = false;
  api.rerender(state);
  check('rerender gak throw dengan state valid', true);
  api.unmount();
  check('unmount gak throw', true);
}

// Deteksi pola bug: rerender(state) harus dibungkus, bukan diteruskan mentah.
{
  const src = await import('node:fs').then(m => m.readFileSync(new URL('../src/ink-squad-ui.js', import.meta.url), 'utf8'));
  check('rerender membungkus props state', /rerender[\s\S]{0,120}createElement\(SquadView,\s*\{\s*state/.test(src));
  check('tidak meneruskan state mentah ke rerender', !/\.rerender\(\s*nextState\s*\)\s*;/.test(src));
}

console.log(`\n=== HASIL INK-RENDERER: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
