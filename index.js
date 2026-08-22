import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { askWithFallback, fallbackState, PROVIDER_NAMES, setModelPrimary, getModelPrimary } from './lib/providers.js';
import { planStep } from './lib/plan.js';
import { showDiff } from './lib/diff.js';
import { runCommand } from './lib/bash.js';
import { logStep, saveDecision, getRecentDecisions, saveSnapshot, getLatestSnapshot, listSnapshots } from './lib/db.js';
import { discoverTools, callTool } from './lib/mcp.js';
import { print, printBlock, printList, header, sep, blank, PROMPT, SLASH_COMMANDS, completer } from './lib/ui.js';

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG]', ...args); };

const MAX_LOOPS = 10;
const sessionAllowed = new Set();

// Session stats
const stats = { tasks: 0, llmCalls: 0, byProvider: {}, byAction: {} };
function trackProvider(name) {
  stats.llmCalls++;
  stats.byProvider[name] = (stats.byProvider[name] || 0) + 1;
}
function trackAction(action) {
  stats.byAction[action] = (stats.byAction[action] || 0) + 1;
}

const ALWAYS_ASK_PATTERNS = [
  /\brm\b/, /\bsudo\b/, /\bchmod\b/, /\bdd\b/,
  /\bnpm\s+uninstall\b/, /\bpkg\s+uninstall\b/, /\bkill\b/
];

function isDangerous(command) {
  return ALWAYS_ASK_PATTERNS.some(p => p.test(command));
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function readFileSafe(target) {
  if (!target || !fs.existsSync(target)) return '(file belum ada / belum ditentukan)';
  return fs.readFileSync(target, 'utf8');
}

function listDirSafe(target) {
  const dir = (target || '.').trim();
  if (!fs.existsSync(dir)) return `(direktori '${dir}' tidak ditemukan)`;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.length === 0) return '(kosong)';
    return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
  } catch (err) {
    return `(error baca direktori: ${err.message})`;
  }
}

function loadAgentMd() {
  const path = './AGENT.md';
  if (!fs.existsSync(path)) return null;
  return fs.readFileSync(path, 'utf8');
}

async function askApproval(label, { forceAsk = false } = {}) {
  if (!forceAsk && sessionAllowed.has(label)) {
    print('auto', `${label} diizinkan untuk sesi ini.`);
    return { approved: true, condition: null };
  }

  if (forceAsk) print('warn', 'Command destruktif — "allow for session" tidak tersedia.');

  console.log('  1) Allow once');
  if (!forceAsk) console.log('  2) Allow for this session');
  console.log('  3) Do not approve');
  console.log('  4) Approve with condition');

  const choice = (await ask(PROMPT)).trim();

  if (choice === '1') return { approved: true, condition: null };

  if (choice === '2') {
    if (forceAsk) {
      print('warn', 'Tidak tersedia untuk command destruktif.');
      return { approved: false, condition: null };
    }
    sessionAllowed.add(label);
    print('session_ok', `${label} akan auto-approved sampai /exit.`);
    return { approved: true, condition: null };
  }

  if (choice === '3') return { approved: false, condition: null };

  if (choice === '4') {
    const condition = await ask('  Ketik kondisi: ');
    console.log(`\n  Kondisi yang akan diteruskan: "${condition.trim()}"`);
    const confirm = await ask('  Lanjut? (y/n): ');
    if (confirm.trim().toLowerCase() !== 'y') return { approved: false, condition: null };
    return { approved: true, condition: condition.trim() };
  }

  print('warn', 'Input tidak valid — default: tidak diapprove.');
  return { approved: false, condition: null };
}

async function runTask(instruction, agentMd, availableTools) {
  stats.tasks++;
  const history = [];
  let lastTarget = null;
  const recentMemory = getRecentDecisions(5);

  dbg('=== Task Start ===');
  dbg('Instruction:', instruction);
  dbg('agentMd:', agentMd ? `loaded (${agentMd.length} chars)` : 'not found');
  dbg('recentMemory:', recentMemory.length, 'entries');
  dbg('availableTools:', availableTools?.map(t => t.name) || []);

  for (let i = 1; i <= MAX_LOOPS; i++) {
    const fileSnapshot = readFileSafe(lastTarget);
    dbg(`--- Loop ${i} ---`);
    dbg('fileSnapshot:', fileSnapshot.slice(0, 100) + (fileSnapshot.length > 100 ? '...' : ''));

    const step = await planStep(askWithFallback, { instruction, fileSnapshot, history, agentMd, recentMemory, availableTools });
    trackProvider(fallbackState.lastProvider);
    trackAction(step.action);

    dbg('Parsed step:', JSON.stringify({ action: step.action, target: step.target, tool: step.tool }).replace(/undefined/g, '-'));

    print('provider', fallbackState.lastProvider);
    print('reasoning', step.reasoning);

    // --- DONE ---
    if (step.action === 'done') {
      print('done', step.summary);
      logStep({ task: instruction, actionType: 'done', detail: null, reasoning: step.reasoning, approved: true });
      blank();
      return;
    }
    
    // --- CHAT (no step header, no ceremony) ---
   if (step.action === 'chat') {
     trackProvider(fallbackState.lastProvider);
    trackAction('chat');
    blank();
    printBlock(step.reply);
    blank();
    history.push({ action: 'chat', reply: step.reply });
  continue;
}

// Untuk semua action teknis — baru tampilkan header
    blank();
    sep();
    print('step', `${i} / ${MAX_LOOPS}`);
    sep();
    print('provider', fallbackState.lastProvider);
   print('reasoning', step.reasoning);

    // --- READ ---
    if (step.action === 'read') {
      const content = readFileSafe(step.target);
      const preview = content.length > 2000
        ? content.slice(0, 2000) + '\n[...TRUNCATED]'
        : content;
      print('read', step.target);
      printBlock(preview);
      history.push({ action: 'read', target: step.target, content: preview });
      continue;
    }

    // --- LIST_DIR ---
    if (step.action === 'list_dir') {
      const listing = listDirSafe(step.target);
      const dir = (step.target || '.').trim();
      print('list_dir', dir);
      printBlock(listing);
      history.push({ action: 'list_dir', target: dir, listing });
      continue;
    }

    // --- REMEMBER ---
    if (step.action === 'remember') {
      saveDecision({ key: step.key, value: step.value, context: instruction });
      print('remember', `${step.key}: ${step.value}`);
      history.push({ action: 'remember', key: step.key, value: step.value });
      continue;
    }

    // --- MCP_CALL ---
    if (step.action === 'mcp_call') {
      print('mcp', `Memanggil tool: ${step.tool}`);
      try {
        const result = await callTool(step.tool, step.toolArgs);
        print('mcp', 'Hasil:');
        printBlock(result.slice(0, 500) + (result.length > 500 ? '...' : ''));
        history.push({ action: 'mcp_call', tool: step.tool, result });
      } catch (err) {
        print('mcp_err', err.message);
        history.push({ action: 'mcp_call', tool: step.tool, result: `ERROR: ${err.message}` });
      }
      continue;
    }

    // --- EDIT ---
    if (step.action === 'edit') {
      const current = readFileSafe(step.target);
      print('diff', step.target);
      printBlock(showDiff(current === '(file belum ada / belum ditentukan)' ? '' : current, step.new_content));
      sep();

      const editApproval = await askApproval('edit');
      logStep({ task: instruction, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });

      if (!editApproval.approved) {
        print('rejected', 'Langkah dibatalkan, task dihentikan.');
        return;
      }
      if (editApproval.condition) {
        history.push({ action: 'user_condition', condition: editApproval.condition });
      }

      const existingContent = readFileSafe(step.target);
      if (existingContent !== '(file belum ada / belum ditentukan)') {
        saveSnapshot({ filepath: step.target, content: existingContent });
        print('snapshot', `${step.target} disimpan.`);
      }

      fs.writeFileSync(step.target, step.new_content, 'utf8');
      print('edit_ok', `${step.target} diupdate.`);
      lastTarget = step.target;
      history.push({ action: 'edit', target: step.target, approved: true });
      continue;
    }

    // --- BASH ---
    if (step.action === 'bash') {
      print('bash', step.command);

      const { checkPackageSafety } = await import('./lib/package-safety.js');
      const safety = await checkPackageSafety(step.command);

      if (safety) {
        print('safety', '');
        safety.flags.forEach(f => printBlock(f));
        if (safety.blocked) {
          print('blocked', 'Command diblokir otomatis karena alasan keamanan.');
          logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, blocked: true }, reasoning: step.reasoning, approved: false });
          print('rejected', 'Command dibatalkan, task dihentikan.');
          return;
        }
      }

      const dangerous = isDangerous(step.command);
      const bashApproval = await askApproval('bash', { forceAsk: dangerous });

      if (!bashApproval.approved) {
        logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        print('rejected', 'Command dibatalkan, task dihentikan.');
        return;
      }
      if (bashApproval.condition) {
        history.push({ action: 'user_condition', condition: bashApproval.condition });
      }

      const result = await runCommand(step.command);
      print('exit_code', `${result.code}  stdout: ${result.stdout || '(kosong)'}`);
      if (result.stderr) print('stderr', result.stderr);

      logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      history.push({ action: 'bash', command: step.command, approved: true, result });
      continue;
    }
  }

  print('stop', `Sampai batas ${MAX_LOOPS} langkah tanpa selesai.`);
  blank();
}

// ── /model handler ────────────────────────────────────────────────────────────
async function handleModel(arg) {
  const providers = PROVIDER_NAMES; // imported from providers.js
  const current = getModelPrimary();

  if (!arg || arg === 'list') {
    print('model', 'Provider yang tersedia:');
    printList(providers, current);
    if (current) print('model', `Aktif: ${current}`);
    else print('model', 'Menggunakan cascade default (xKiro pertama).');
    return;
  }

  const num = parseInt(arg);
  let chosen = null;
  if (!isNaN(num) && num >= 1 && num <= providers.length) {
    chosen = providers[num - 1];
  } else {
    chosen = providers.find(p => p.key === arg.toLowerCase());
  }

  if (!chosen) {
    print('warn', `Provider tidak dikenal: "${arg}". Ketik /model list untuk daftar.`);
    return;
  }

  setModelPrimary(chosen.key);
  print('model', `Primary provider diset ke: ${chosen.label}`);
}

// ── /usage handler ────────────────────────────────────────────────────────────
function handleUsage() {
  print('usage', `Tasks: ${stats.tasks}  |  LLM calls: ${stats.llmCalls}`);

  if (Object.keys(stats.byProvider).length > 0) {
    print('usage', 'Per provider:');
    Object.entries(stats.byProvider)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => printBlock(`${name}: ${count}`, 6));
  }

  if (Object.keys(stats.byAction).length > 0) {
    print('usage', 'Per action:');
    Object.entries(stats.byAction)
      .sort((a, b) => b[1] - a[1])
      .forEach(([action, count]) => printBlock(`${action}: ${count}`, 6));
  }
}

// ── main chat loop ────────────────────────────────────────────────────────────
async function chat() {
  let availableTools = [];
  try {
    availableTools = await discoverTools();
  } catch (err) {
    print('mcp_init', `Gagal discover tools: ${err.message}`);
  }

  const agentMd = loadAgentMd();
  const currentModel = getModelPrimary();
  const modelLabel = currentModel
    ? (PROVIDER_NAMES.find(p => p.key === currentModel)?.label || currentModel)
    : 'xKiro / DeepSeek-v4-Pro';

  header(modelLabel, availableTools.map(t => t.name));

  if (availableTools.length > 0) {
    print('mcp_init', `${availableTools.length} tool: ${availableTools.map(t => t.name).join(', ')}`);
  }
  if (agentMd) print('agent_md', 'Project instructions loaded.');

  try {
    const { distillIfNeeded } = await import('./lib/distill.js');
    await distillIfNeeded(askWithFallback);
  } catch (err) {
    print('distill', `Dilewati: ${err.message}`);
  }

  print('info', 'Ketik instruksi. TAB untuk autocomplete /command.');
  blank();

  while (true) {
    const input = await ask(PROMPT);
    const instruction = input.trim();
    if (!instruction) continue;

    // /exit
    if (instruction.toLowerCase() === '/exit') {
      blank();
      print('info', 'Bye.');
      rl.close();
      process.exit(0);
    }

    // /usage
    if (instruction.toLowerCase() === '/usage') {
      handleUsage();
      continue;
    }

    // /model [arg]
    if (instruction.toLowerCase().startsWith('/model')) {
      const arg = instruction.split(' ').slice(1).join(' ').trim();
      await handleModel(arg);
      continue;
    }

    // /rollback [filepath]
    if (instruction.toLowerCase().startsWith('/rollback')) {
      const filepath = instruction.split(' ')[1];
      if (!filepath) {
        const snaps = listSnapshots();
        if (snaps.length === 0) {
          print('rollback', 'Belum ada snapshot tersimpan.');
        } else {
          print('rollback', 'File yang punya snapshot:');
          snaps.forEach(s => printBlock(`${s.filepath}  —  ${s.versions} versi, terakhir: ${s.last_snapshot}`, 6));
        }
        continue;
      }
      const snap = getLatestSnapshot(filepath);
      if (!snap) {
        print('rollback', `Tidak ada snapshot untuk ${filepath}.`);
        continue;
      }
      const current = readFileSafe(filepath);
      print('diff', `${filepath}  (current → snapshot ${snap.created_at})`);
      printBlock(showDiff(current === '(file belum ada / belum ditentukan)' ? '' : current, snap.content));
      sep();
      const confirm = await ask('  Rollback ke snapshot ini? (y/n): ');
      if (confirm.trim().toLowerCase() === 'y') {
        fs.writeFileSync(filepath, snap.content, 'utf8');
        print('rollback', `${filepath} dikembalikan ke snapshot ${snap.created_at}.`);
      } else {
        print('rollback', 'Dibatalkan.');
      }
      continue;
    }

    // Unknown /command
    if (instruction.startsWith('/')) {
      print('warn', `Command tidak dikenal: "${instruction}".`);
      print('info', 'Commands: ' + SLASH_COMMANDS.map(c => c.cmd).join(', '));
      continue;
    }

    await runTask(instruction, agentMd, availableTools);
  }
}

chat().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});
