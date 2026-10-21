// M29-M32 RED: environment contract, toolchain adapter, language detection.
import { defineEnvironment, preflightEnvironment } from '../src/environment.js';
import { detectProjectLanguages } from '../src/project-language.js';
import { getToolchain, runToolchain } from '../src/toolchains.js';
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0;
const check = (label, ok) => ok ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));
const root = fs.mkdtempSync(path.join(process.cwd(), '.tmp-env-'));

try {
  const env = defineEnvironment({
    commands: [{ name: 'node', required: true }, { name: 'never-command-xyz', required: false }],
    env: [{ name: 'HOME', required: true }, { name: 'MISSING_XYZ', required: false }],
    paths: { read: ['.'], write: ['src'] },
    capabilities: ['filesystem.read'],
    network: false,
  });
  check('contract normalizes defaults', env.commands.length === 2 && env.network === false);
  const ready = await preflightEnvironment(env, { cwd: process.cwd() });
  check('preflight sees node + HOME; optional miss degradasi', ready.status === 'degraded');
  check('optional missing is degraded info, not blocked', !ready.missing.some(x => x.name === 'never-command-xyz'));

  const blocked = await preflightEnvironment(defineEnvironment({ commands: [{ name: 'never-command-xyz', required: true }] }), { cwd: process.cwd() });
  check('required command missing => blocked', blocked.status === 'blocked');
  check('preflight never exposes env value', !JSON.stringify(ready).includes(process.env.HOME));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node test.js' }, dependencies: { typescript: '^5' } }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'const x: number = 1;');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module example.com/x\ngo 1.22\n');
  fs.writeFileSync(path.join(root, 'script.py'), 'print("ok")');
  const langs = detectProjectLanguages(root);
  check('detects typescript from ts + package', langs.some(x => x.language === 'typescript'));
  check('detects go from go.mod', langs.some(x => x.language === 'go'));
  check('detects python from py', langs.some(x => x.language === 'python'));
  check('ranking is deterministic', langs[0].score >= langs[langs.length - 1].score);

  check('python toolchain exists', getToolchain('python').run === 'python3');
  check('go toolchain exists', getToolchain('go').test.includes('go test'));
  check('typescript adapter is optional', getToolchain('typescript').required === false);
  const run = await runToolchain('python', 'print("toolchain-ok")', { cwd: root, approve: async () => true });
  check('runtime adapter executes python', run.ok && run.stdout.includes('toolchain-ok'));

  console.log(`\n=== HASIL ENVIRONMENT: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
