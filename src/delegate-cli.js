// M43: delegate tasks to external CLI agents (qwen, claude, agy) as controlled subprocesses.
// Zero-dependency: pakai child_process bawaan Node. Approval tetap dipegang KIANNNNN.
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// Registry CLI agents yang didukung. Urutan = prioritas fallback.
const CLI_REGISTRY = {
  qwen: {
    command: 'qwen',
    promptFlag: '-p',
    outputFlag: ['--output-format'],
    sandboxFlag: '--sandbox',
    extraFlags: [],
  },
  claude: {
    command: 'claude',
    promptFlag: '-p',
    outputFlag: ['--output-format'],
    sandboxFlag: '--dangerously-skip-permissions', // claude gak punya --sandbox; skip internal approval karena KIANNNNN yang pegang gate
    extraFlags: [],
  },
  agy: {
    command: 'agy',
    promptFlag: '-p',
    outputFlag: ['--output-format'],
    sandboxFlag: '--sandbox',
    extraFlags: ['--dangerously-skip-permissions'],
  },
};

/**
 * Deteksi CLI agent mana yang tersedia di PATH.
 * @returns {Promise<Array<{name:string, command:string, flags:object}>>}
 */
export async function detectCliAgents() {
  const available = [];
  for (const [name, cfg] of Object.entries(CLI_REGISTRY)) {
    try {
      await execFileAsync('sh', ['-c', `command -v ${cfg.command}`]);
      available.push({ name, command: cfg.command, flags: cfg });
    } catch {
      // not in PATH, skip
    }
  }
  return available;
}

/**
 * Bangun command + args untuk spawn CLI agent.
 * @param {string} agentName - 'qwen' | 'claude' | 'agy'
 * @param {string} prompt - task/prompt yang mau di-delegate
 * @param {object} opts - { sandbox, outputFormat, effort, model, addDirs, jsonSchema, mode }
 * @returns {{ cmd: string, args: string[] }}
 */
export function buildDelegateCommand(agentName, prompt, opts = {}) {
  const cfg = CLI_REGISTRY[agentName];
  if (!cfg) throw new Error(`CLI agent tidak dikenal: ${agentName}. Yang didukung: ${Object.keys(CLI_REGISTRY).join(', ')}`);

  const args = [];

  // Prompt flag
  args.push(cfg.promptFlag, prompt);

  // Output format
  const fmt = opts.outputFormat || 'json';
  if (cfg.outputFlag.length === 1) {
    args.push(cfg.outputFlag[0], fmt);
  } else if (cfg.outputFlag.length === 2) {
    args.push(cfg.outputFlag[0], cfg.outputFlag[1], fmt);
  }

  // Sandbox
  if (opts.sandbox !== false && cfg.sandboxFlag) {
    args.push(cfg.sandboxFlag);
  }

  // Extra flags per agent
  for (const f of cfg.extraFlags) args.push(f);

  // Effort (agy specific)
  if (opts.effort && agentName === 'agy') {
    args.push('--effort', opts.effort);
  }

  // Model override
  if (opts.model) {
    args.push('--model', opts.model);
  }

  // Add dirs (whitelist folder akses)
  if (Array.isArray(opts.addDirs)) {
    for (const dir of opts.addDirs) {
      args.push('--add-dir', dir);
    }
  }

  // JSON schema (agy specific)
  if (opts.jsonSchema && agentName === 'agy') {
    args.push('--json-schema', typeof opts.jsonSchema === 'string' ? opts.jsonSchema : JSON.stringify(opts.jsonSchema));
  }

  // Mode (agy: accept-edits | plan)
  if (opts.mode && agentName === 'agy') {
    args.push('--mode', opts.mode);
  }

  return { cmd: cfg.command, args };
}

/**
 * Parse output dari CLI agent jadi struktur standar.
 * @param {string} raw - stdout dari CLI
 * @param {string} format - 'json' | 'text'
 * @returns {{ ok: boolean, summary: string, data?: object, error?: string }}
 */
export function parseDelegateOutput(raw, format = 'json') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: false, summary: '', error: 'output kosong' };

  if (format === 'json') {
    try {
      const parsed = JSON.parse(trimmed);
      // qwen/claude/agy JSON output formats vary; normalize
      const summary = parsed.summary || parsed.result || parsed.text || parsed.content || trimmed;
      return { ok: true, summary: String(summary), data: parsed };
    } catch {
      // Fallback: treat as text
      return { ok: true, summary: trimmed };
    }
  }

  return { ok: true, summary: trimmed };
}

/**
 * Delegate satu task ke CLI agent sebagai subprocess terkontrol.
 * spawnFn bisa di-inject untuk testing tanpa beneran spawn process.
 *
 * @param {string} agentName - 'qwen' | 'claude' | 'agy'
 * @param {string} prompt - task description
 * @param {object} opts - { sandbox, outputFormat, effort, model, addDirs, cwd, timeoutMs, spawnFn }
 * @returns {Promise<{ ok: boolean, summary: string, agent: string, error?: string }>}
 */
export async function delegateTask(agentName, prompt, opts = {}) {
  const format = opts.outputFormat || 'json';
  const timeoutMs = opts.timeoutMs || 120_000; // default 2 menit
  const cwd = opts.cwd || process.cwd();

  // Injected spawn function (untuk testing) — skip registry validation
  if (typeof opts.spawnFn === 'function') {
    let cmd = agentName, args = [prompt];
    try {
      const built = buildDelegateCommand(agentName, prompt, opts);
      cmd = built.cmd;
      args = built.args;
    } catch {
      // agent gak ada di registry, pakai nama mentah buat test
    }
    const result = await opts.spawnFn(cmd, args, { cwd, timeout: timeoutMs });
    if (result.code !== 0) {
      return { ok: false, summary: '', agent: agentName, error: result.stderr || `exit code ${result.code}` };
    }
    const parsed = parseDelegateOutput(result.stdout, format);
    return { ...parsed, agent: agentName };
  }

  const { cmd, args } = buildDelegateCommand(agentName, prompt, opts);

  // Real spawn via child_process
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env },
    });
    const parsed = parseDelegateOutput(stdout, format);
    return { ...parsed, agent: agentName };
  } catch (err) {
    // execFile throws on non-zero exit or timeout
    const stdout = err.stdout || '';
    const stderr = err.stderr || err.message || '';
    if (stdout) {
      const parsed = parseDelegateOutput(stdout, format);
      if (parsed.ok) return { ...parsed, agent: agentName };
    }
    return { ok: false, summary: '', agent: agentName, error: stderr.slice(0, 500) };
  }
}
