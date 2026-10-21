// M30/M32: runtime adapters with bounded execution and explicit approval.
import { spawn } from 'child_process';

const TOOLCHAINS = {
  python: { language: 'python', run: 'python3', test: 'pytest', compile: null, required: true },
  go: { language: 'go', run: 'go run', test: 'go test ./...', compile: 'go build ./...', required: true },
  typescript: { language: 'typescript', run: 'node', test: 'tsc --noEmit', compile: 'tsc', required: false },
  javascript: { language: 'javascript', run: 'node', test: 'node --check', compile: null, required: true },
};
export function getToolchain(language) { return TOOLCHAINS[language] || null; }
function commandFor(language, source) { const t = getToolchain(language); if (!t) throw new Error(`toolchain tidak dikenal: ${language}`); if (language === 'python') return ['python3', ['-c', source]]; if (language === 'go') return ['go', ['run', source]]; return ['node', ['-e', source]]; }
export function runToolchain(language, source, { cwd = process.cwd(), approve = async () => true, timeoutMs = 30000 } = {}) {
  return new Promise(async resolve => {
    const ok = await approve(language);
    if (!ok) return resolve({ ok: false, blocked: true, code: null, stdout: '', stderr: 'toolchain approval ditolak' });
    let cmd, args; try { [cmd, args] = commandFor(language, source); } catch (err) { return resolve({ ok: false, code: null, stdout: '', stderr: err.message }); }
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ ok: false, timedOut: true, code: null, stdout, stderr: stderr || 'timeout' }); }, timeoutMs);
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
  });
}
export { TOOLCHAINS };
