import { runCommand } from '../../bash.js';

/** Core execution boundary for shell actions. */
export async function executeBash(command, deps = {}) {
  return (deps.runCommand || runCommand)(command);
}
