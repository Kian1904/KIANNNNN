// M43 RED: delegate-cli adapter — spawn qwen/claude/agy sebagai subprocess terkontrol.
import { detectCliAgents, buildDelegateCommand, parseDelegateOutput, delegateTask } from '../src/delegate-cli.js';
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

// --- detectCliAgents ---
const detected = await detectCliAgents();
check('detectCliAgents returns array', Array.isArray(detected));
check('detectCliAgents finds at least one agent on this system', detected.length >= 1);
for (const agent of detected) {
  check(`detected agent has name+command+flags: ${agent.name}`, agent.name && agent.command && agent.flags);
}

// --- buildDelegateCommand ---
const cmdQwen = buildDelegateCommand('qwen', 'buat file hello.txt berisi hello', { sandbox: true, outputFormat: 'json' });
check('qwen command uses -p flag', cmdQwen.args.includes('-p'));
check('qwen command uses --sandbox', cmdQwen.args.includes('--sandbox'));
check('qwen command uses --output-format json', cmdQwen.args.includes('--output-format') && cmdQwen.args.includes('json'));
check('qwen command includes prompt', cmdQwen.args.includes('buat file hello.txt berisi hello'));

const cmdAgy = buildDelegateCommand('agy', 'review kode ini', { sandbox: true, outputFormat: 'json', effort: 'low' });
check('agy command uses --print', cmdAgy.args.includes('--print') || cmdAgy.args.includes('-p'));
check('agy command uses --effort low', cmdAgy.args.includes('--effort') && cmdAgy.args.includes('low'));

const cmdClaude = buildDelegateCommand('claude', 'fix bug login', { sandbox: false, outputFormat: 'text' });
check('claude command uses -p', cmdClaude.args.includes('-p') || cmdClaude.args.includes('--print'));

// unknown agent throws
try { buildDelegateCommand('unknown-agent', 'test'); check('unknown agent should throw', false); }
catch { check('unknown agent throws error', true); }

// --- parseDelegateOutput ---
const jsonOut = parseDelegateOutput('{"result":"ok","summary":"file dibuat"}', 'json');
check('parse JSON output extracts summary', jsonOut.ok && jsonOut.summary === 'file dibuat');

const textOut = parseDelegateOutput('ini hasil kerja manual', 'text');
check('parse text output wraps as summary', textOut.ok && textOut.summary === 'ini hasil kerja manual');

const emptyOut = parseDelegateOutput('', 'text');
check('empty output is rejected', !emptyOut.ok);

const badJson = parseDelegateOutput('{invalid json}', 'json');
check('bad JSON falls back to text', badJson.ok && badJson.summary.includes('invalid json'));

// --- delegateTask with mock spawn ---
const mockResult = await delegateTask('echo-test', 'hello world', {
  spawnFn: (cmd, args, opts) => new Promise(resolve => {
    // Simulasi CLI yang sukses
    resolve({ code: 0, stdout: '{"result":"success","summary":"hello world done"}', stderr: '' });
  }),
  outputFormat: 'json',
});
check('delegateTask returns ok:true on success', mockResult.ok === true);
check('delegateTask captures summary', mockResult.summary === 'hello world done');

const failResult = await delegateTask('echo-test', 'hello', {
  spawnFn: () => new Promise(resolve => resolve({ code: 1, stdout: '', stderr: 'crash' })),
});
check('delegateTask returns ok:false on non-zero exit', failResult.ok === false);
check('delegateTask captures stderr on failure', failResult.error.includes('crash'));

console.log(`\n=== HASIL DELEGATE-CLI: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
