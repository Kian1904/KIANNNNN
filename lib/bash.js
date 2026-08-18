import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TIMEOUT_MS = 60_000;

export async function runCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: TIMEOUT_MS });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (err) {
    // exec() throw kalau exit code != 0 — err punya .stdout/.stderr/.code
    return {
      ok: false,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
      code: err.code ?? 1
    };
  }
}
