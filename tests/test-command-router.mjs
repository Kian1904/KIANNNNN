// M63+M64 RED: CLI command parity + model capability routing.
import {
  getCommandList, isRegisteredCommand, COMMANDS,
} from '../src/command-registry.js';
import {
  routeByCapability, MODEL_CAPABILITIES, pickBestModel,
} from '../src/model-router.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── M63: command registry ───────────────────────────────────────────────────
{
  const cmds = getCommandList();
  check('commands: array non-empty', Array.isArray(cmds) && cmds.length > 0);
  check('commands: punya /status', isRegisteredCommand('/status'));
  check('commands: punya /history', isRegisteredCommand('/history'));
  check('commands: punya /stop', isRegisteredCommand('/stop'));
  check('commands: punya /resume', isRegisteredCommand('/resume'));
  check('commands: punya /retry', isRegisteredCommand('/retry'));
  check('commands: punya /replan', isRegisteredCommand('/replan'));
  check('commands: punya /save', isRegisteredCommand('/save'));
  check('commands: punya /load', isRegisteredCommand('/load'));
  check('commands: /squad masih ada', isRegisteredCommand('/squad'));
  check('commands: /help masih ada', isRegisteredCommand('/help'));
  check('commands: unknown -> false', isRegisteredCommand('/ghost') === false);
  check('commands: COMMANDS punya name + desc', COMMANDS.every(c => c.name && c.desc));
}

// ── M64: model capability routing ───────────────────────────────────────────
{
  check('capabilities: ada coding', MODEL_CAPABILITIES.coding != null);
  check('capabilities: ada research', MODEL_CAPABILITIES.research != null);
  check('capabilities: ada casual', MODEL_CAPABILITIES.casual != null);
  check('capabilities: ada review', MODEL_CAPABILITIES.review != null);
}
{
  const best = pickBestModel('coding', [
    { name: 'fast-model', capabilities: ['casual'] },
    { name: 'smart-model', capabilities: ['coding', 'review'] },
    { name: 'research-model', capabilities: ['research'] },
  ]);
  check('routing: coding -> smart-model', best && best.name === 'smart-model');
}
{
  const best = pickBestModel('casual', [
    { name: 'fast-model', capabilities: ['casual'] },
    { name: 'smart-model', capabilities: ['coding'] },
  ]);
  check('routing: casual -> fast-model', best && best.name === 'fast-model');
}
{
  const best = pickBestModel('unknown', []);
  check('routing: kosong -> null', best === null);
}
{
  const r = routeByCapability('bikin fungsi sorting', [
    { name: 'a', capabilities: ['coding'] },
    { name: 'b', capabilities: ['casual'] },
  ]);
  check('routeByCapability: deteksi coding', r.model != null);
}

console.log(`\n=== HASIL COMMAND+ROUTING: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
