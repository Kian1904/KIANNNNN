// M46: UI mode selection regression (prefix K_ baru + kompat K_SROUTER_).
import { shouldUseInk } from '../src/squad-ui.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
check('ink only on explicit TTY mode', shouldUseInk({ env: { K_UI: 'ink' }, stdout: { isTTY: true } }));
check('plain on non-TTY', !shouldUseInk({ env: { K_UI: 'ink' }, stdout: { isTTY: false } }));
check('plain by default', !shouldUseInk({ env: {}, stdout: { isTTY: true } }));
check('legacy K_SROUTER_UI masih kebaca', shouldUseInk({ env: { K_SROUTER_UI: 'ink' }, stdout: { isTTY: true } }));
check('K_UI menang atas legacy', !shouldUseInk({ env: { K_UI: 'plain', K_SROUTER_UI: 'ink' }, stdout: { isTTY: true } }));
console.log(`\n=== HASIL SQUAD-UI-MODE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
