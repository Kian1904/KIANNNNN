// M29: environment contracts + fail-closed preflight.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

export function defineEnvironment(input = {}) {
  return {
    commands: Array.isArray(input.commands) ? input.commands.map(x => typeof x === 'string' ? { name: x, required: true } : { required: true, ...x }) : [],
    env: Array.isArray(input.env) ? input.env.map(x => typeof x === 'string' ? { name: x, required: true } : { required: true, ...x }) : [],
    paths: { read: input.paths?.read || [], write: input.paths?.write || [] },
    capabilities: Array.isArray(input.capabilities) ? [...input.capabilities] : [],
    network: input.network === true,
    minMemoryMb: Number.isFinite(input.minMemoryMb) ? input.minMemoryMb : null,
  };
}

export async function preflightEnvironment(contract, { cwd = process.cwd(), env = process.env } = {}) {
  const c = defineEnvironment(contract);
  const missing = [];
  const optionalMissing = [];
  for (const command of c.commands) {
    try { await execFileAsync('sh', ['-c', `command -v -- ${JSON.stringify(command.name)}`], { cwd }); }
    catch { (command.required ? missing : optionalMissing).push({ type: 'command', name: command.name }); }
  }
  for (const item of c.env) {
    if (!env[item.name]) (item.required ? missing : optionalMissing).push({ type: 'env', name: item.name });
  }
  const badPaths = [];
  for (const p of c.paths.read || []) if (p !== '.' && !fs.existsSync(path.resolve(cwd, p))) badPaths.push({ type: 'path', path: p, access: 'read' });
  for (const p of c.paths.write || []) if (p !== '.' && !fs.existsSync(path.resolve(cwd, p))) badPaths.push({ type: 'path', path: p, access: 'write' });
  missing.push(...badPaths);
  return { status: missing.length ? 'blocked' : (optionalMissing.length ? 'degraded' : 'ready'), missing, optionalMissing, capabilities: c.capabilities, network: c.network };
}
