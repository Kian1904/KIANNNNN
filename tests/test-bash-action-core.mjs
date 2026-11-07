import { buildBashHistory, formatBashOutput } from '../src/core/bash-actions.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const result = { ok: true, code: 0, stdout: 'hello', stderr: '', truncated: false };
const verification = { ok: true, reason: 'exit code 0' };
const history = buildBashHistory('echo hello', result, verification);

check('history preserves command', history.command === 'echo hello');
check('history preserves result', history.result === result);
check('history marks verified success', history.verified === true);
check('history has no error on success', history.error === undefined);
check('output includes stdout and exit code', /Exit code: 0/.test(formatBashOutput('echo hello', result)) && /hello/.test(formatBashOutput('echo hello', result)));

const failed = buildBashHistory('false', { ok: false, code: 1, stdout: '', stderr: 'bad' }, { ok: false, reason: 'command gagal (exit 1)' });
check('failed history is unverified', failed.verified === false);
check('failed history has reason', failed.error === 'command gagal (exit 1)');

console.log(`\n=== HASIL BASH-ACTION-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
