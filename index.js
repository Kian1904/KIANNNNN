import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { askWithFallback, fallbackState, PROVIDER_NAMES, setModelPrimary, getModelPrimary } from './lib/providers.js';
import { planStep } from './lib/plan.js';
import { showDiff } from './lib/diff.js';
import { runCommand } from './lib/bash.js';
import { logStep, saveDecision, getRecentDecisions, saveSnapshot, getLatestSnapshot, listSnapshots } from './lib/db.js';
import { discoverTools, callTool } from './mcp/client.js';
import { searchWeb } from './lib/search.js';
import { print, printBlock, printList, printUserMessage, printAssistantMessage, printSystemMessage, header, sep, blank, PROMPT, SLASH_COMMANDS, completer } from './lib/ui.js';
import { classifyIntent } from './lib/intent.js';
import { readFileSafe, listDirSafe, loadAgentMd } from './lib/utils/fs.js';
import { handleModel } from './lib/commands/model.js';
import { handleUsage } from './lib/commands/usage.js';
import { handleConnect } from './lib/commands/connect.js';

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG]', ...args); };

const MAX_LOOPS = 20;
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

async function runCasual(instruction, history = []) {
  const historyText = history.length > 0 
    ? 'Context percakapan sebelumnya:\n' + history.map(h => `${h.type}: ${h.content}`).join('\n') + '\n\n'
    : '';
    
  const CASUAL_SYSTEM = `Kamu asisten AI yang helpful dan natural. Jawab dengan santai dan langsung — tidak perlu format khusus, tidak perlu list kecuali memang relevan. Gunakan bahasa yang sama dengan user.${historyText ? `\n\n${historyText}` : ''}`;
  
  try {
    const reply = await askWithFallback(CASUAL_SYSTEM, instruction);
    blank();
    printBlock(reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
    blank();
    trackProvider(fallbackState.lastProvider);
    trackAction('casual');
    return reply; // Return the reply so it can be added to session history
  } catch (err) {
    print('error', `Gagal: ${err.message}`);
    return `Error: ${err.message}`;
  }
}

async function runTask(instruction, agentMd, availableTools, threadId = null) {
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

    // --- DONE ---
    if (step.action === 'done') {
      print('done', step.summary);
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: step.summary, actionType: 'done', reasoning: step.reasoning, approved: true });
      } else {
        logStep({ task: instruction, actionType: 'done', detail: null, reasoning: step.reasoning, approved: true });
      }
      blank();
      return;
    }

    // --- CHAT (no step header, no ceremony) ---
   if (step.action === 'chat') {
    blank();
    printBlock(step.reply);
    blank();
    history.push({ action: 'chat', reply: step.reply });
    if (threadId) {
      logStep({ threadId, role: 'assistant', content: step.reply, actionType: 'chat', reasoning: step.reasoning });
    }
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
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Read file: ${step.target}\n${preview}`, actionType: 'read', reasoning: step.reasoning });
      }
      continue;
    }

    // --- LIST_DIR ---
    if (step.action === 'list_dir') {
      const listing = listDirSafe(step.target);
      const dir = (step.target || '.').trim();
      print('list_dir', dir);
      printBlock(listing);
      history.push({ action: 'list_dir', target: dir, listing });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Listed directory: ${dir}\n${listing}`, actionType: 'list_dir', reasoning: step.reasoning });
      }
      continue;
    }

    // --- REMEMBER ---
    if (step.action === 'remember') {
      saveDecision({ key: step.key, value: step.value, context: instruction });
      print('remember', `${step.key}: ${step.value}`);
      history.push({ action: 'remember', key: step.key, value: step.value });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Remembered: ${step.key} = ${step.value}`, actionType: 'remember', reasoning: step.reasoning });
      }
      continue;
    }

    // --- MCP_CALL ---
    if (step.action === 'mcp_call') {
      print('mcp', `Memanggil tool: ${step.tool}`);
      try {
        const result = await callTool(step.tool, step.toolArgs, availableTools);
        print('mcp', 'Hasil:');
        printBlock(result.slice(0, 2500) + (result.length > 500 ? '...' : ''));
        history.push({ action: 'mcp_call', tool: step.tool, result });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Called tool: ${step.tool}\nResult: ${result.slice(0, 500)}${result.length > 500 ? '...' : ''}`, actionType: 'mcp_call', detail: { tool: step.tool, result }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('mcp_err', err.message);
        history.push({ action: 'mcp_call', tool: step.tool, result: `ERROR: ${err.message}` });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Tool error: ${step.tool}\nError: ${err.message}`, actionType: 'mcp_call', detail: { tool: step.tool, error: err.message }, reasoning: step.reasoning });
        }
      }
      // Auto-done jika task hanya satu mcp_call dan tidak ada kata lanjutan
      const continueWords = /(lanjut|terus|setelah|kemudian|lalu|selanjutnya)/i;
      if (history.length === 1 && !continueWords.test(instruction)) {
        print('done', 'Task selesai dengan mcp_call.');
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: 'Task selesai dengan mcp_call.', actionType: 'done', reasoning: 'Auto-done after mcp_call', approved: true });
        } else {
          logStep({ task: instruction, actionType: 'done', detail: null, reasoning: 'Auto-done after mcp_call', approved: true });
        }
        blank();
        return;
      }
      continue;
    }

    // --- WEB_SEARCH ---
    if (step.action === 'web_search') {
      print('web_search', step.query);
      try {
        const { provider, results } = await searchWeb(step.query);
        // Hasil mentah (snippet penuh) TIDAK ditampilkan ke user — cuma sumber (url).
        // Snippet lengkap dipush ke history buat direasoning-in LLM di langkah berikutnya,
        // lalu user lihat reasoning+sumber lewat ACTION: done SUMMARY.
        print('sources', results.length ? results.map(r => r.url).join('\n') : '(tidak ada hasil)');
        const summary = results
          .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n');
        history.push({ action: 'web_search', query: step.query, provider, summary: summary || '(tidak ada hasil)' });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Searched: ${step.query}\nSources: ${results.map(r => r.url).join(', ')}`, actionType: 'web_search', detail: { query: step.query, provider, sources: results.map(r => r.url) }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('search_err', err.message);
        history.push({ action: 'web_search', query: step.query, provider: null, summary: `ERROR: ${err.message}` });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Search error: ${step.query}\nError: ${err.message}`, actionType: 'web_search', detail: { query: step.query, error: err.message }, reasoning: step.reasoning });
        }
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
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Edit requested: ${step.target}`, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });
      } else {
        logStep({ task: instruction, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });
      }

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
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `File edited: ${step.target}`, actionType: 'edit', detail: { target: step.target, applied: true }, reasoning: step.reasoning });
      }
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
          if (threadId) {
            logStep({ threadId, role: 'assistant', content: `Command blocked: ${step.command}`, actionType: 'bash', detail: { command: step.command, blocked: true }, reasoning: step.reasoning, approved: false });
          } else {
            logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, blocked: true }, reasoning: step.reasoning, approved: false });
          }
          print('rejected', 'Command dibatalkan, task dihentikan.');
          return;
        }
      }

      const dangerous = isDangerous(step.command);
      const bashApproval = await askApproval('bash', { forceAsk: dangerous });

      if (!bashApproval.approved) {
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Command denied: ${step.command}`, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        } else {
          logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        }
        print('rejected', 'Command dibatalkan, task dihentikan.');
        return;
      }
      if (bashApproval.condition) {
        history.push({ action: 'user_condition', condition: bashApproval.condition });
      }

      const result = await runCommand(step.command);
      print('exit_code', `${result.code}  stdout: ${result.stdout || '(kosong)'}`);
      if (result.stderr) print('stderr', result.stderr);

      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Command executed: ${step.command}\nExit code: ${result.code}\nStdout: ${result.stdout || '(kosong)'}`, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      } else {
        logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      }
      history.push({ action: 'bash', command: step.command, approved: true, result });
      continue;
    }
  }

  print('stop', `Sampai batas ${MAX_LOOPS} langkah tanpa selesai.`);
  if (threadId) {
    logStep({ threadId, role: 'assistant', content: `Reached loop limit of ${MAX_LOOPS} without completing task.`, actionType: 'stop', reasoning: 'Loop limit reached' });
  }
  blank();
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

  // Session state untuk maintain conversation history dalam 1 sesi
  const sessionAllowed = new Set();
  
  // Create new conversation thread for this session
  const { createThread, logStep, getConversation } = await import('./lib/db.js');
  const threadId = createThread();
  print('info', `Thread #${threadId} dibuat untuk sesi ini.`);

  // Show initial system message
  printSystemMessage(`KIANNNNN aktif. Mode percakapan dimulai.\nKetik pesan kamu atau gunakan /command.\nGunakan /help untuk daftar perintah.`);

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
      handleUsage(stats);
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

    // /connect [add <url> | toggle <name>]
    if (instruction.toLowerCase().startsWith('/connect')) {
      const arg = instruction.split(' ').slice(1).join(' ').trim();
      const changed = await handleConnect(arg);
      if (changed) {
        try {
          availableTools = await discoverTools();
          print('mcp_init', `${availableTools.length} tool aktif: ${availableTools.map(t => t.name).join(', ') || '(tidak ada)'}`);
        } catch (err) {
          print('mcp_init', `Gagal rediscover: ${err.message}`);
        }
      }
      continue;
    }

    // /help - show available commands
    if (instruction.toLowerCase() === '/help') {
      print('info', 'Daftar perintah yang tersedia:');
      const commands = [
        { cmd: '/help', desc: 'Tampilkan bantuan ini' },
        { cmd: '/exit', desc: 'Keluar dari KIANNNNN' },
        { cmd: '/model', desc: 'Lihat atau ganti model AI' },
        { cmd: '/usage', desc: 'Statistik penggunaan sesi ini' },
        { cmd: '/connect', desc: 'Kelola koneksi MCP (plugin)' },
        { cmd: '/clear', desc: 'Bersihkan percakapan saat ini (buat thread baru)' },
        { cmd: '/history', desc: 'Lihat riwayat percakapan di sesi ini' },
        { cmd: '/save', desc: 'Simpan percakapan saat ini dengan judul' },
        { cmd: '/load', desc: 'Muat percakapan lama dari database' },
        { cmd: '/reset', desc: 'Reset sesi ke kondisi awal (buat thread baru)' }
      ];
      commands.forEach(c => {
        printBlock(`${c.cmd.padEnd(12)} — ${c.desc}`, 2);
      });
      continue;
    }

    // /clear - clear current conversation thread (close current thread and start new one)
    if (instruction.toLowerCase() === '/clear') {
      print('info', 'Membersihkan percakapan saat ini...');
      
      // Create new conversation thread for this session
      const newThreadId = createThread();
      print('info', `Thread #${newThreadId} dibuat untuk sesi ini.`);
      threadId = newThreadId;
      
      printSystemMessage(`Percakapan direset. Silakan mulai percakapan baru.`);
      continue;
    }

    // /history - show session history from DB
    if (instruction.toLowerCase() === '/history') {
      const { getConversation } = await import('./lib/db.js');
      const history = getConversation(threadId, 50); // Get last 50 messages
      
      if (history.length === 0) {
        print('info', 'Tidak ada riwayat percakapan di sesi ini.');
      } else {
        print('info', `Menampilkan ${history.length} item riwayat dari thread #${threadId}:`);
        history.forEach((entry, index) => {
          if (entry.role === 'user') {
            printUserMessage(entry.content);
          } else if (entry.role === 'assistant') {
            printAssistantMessage(entry.content);
          }
        });
      }
      continue;
    }

    // /save - save conversation to DB as named conversation
    if (instruction.toLowerCase() === '/save') {
      const { updateThreadTitle } = await import('./lib/db.js');
      
      // Ask for a title for the conversation
      const title = await ask('  Masukkan judul untuk menyimpan percakapan ini: ');
      if (!title.trim()) {
        print('info', 'Judul kosong, percakapan tidak disimpan.');
        continue;
      }
      
      updateThreadTitle(threadId, title.trim());
      print('info', `Percakapan disimpan dengan judul: "${title.trim()}"`);
      continue;
    }

    // /load - load conversation from DB (list and select)
    if (instruction.toLowerCase() === '/load') {
      const { getAllThreads } = await import('./lib/db.js');
      const threads = getAllThreads(10); // Get last 10 threads
      
      if (threads.length === 0) {
        print('info', 'Tidak ada percakapan tersimpan.');
        continue;
      }
      
      print('info', 'Percakapan tersimpan:');
      threads.forEach((thread, index) => {
        const date = new Date(thread.updated_at).toLocaleString();
        printBlock(`${index + 1}. [${thread.id}] ${thread.title || 'Untitled Conversation'} (${date})`, 2);
      });
      
      const selection = await ask('  Pilih nomor percakapan untuk dimuat (atau kosongkan untuk batal): ');
      const num = parseInt(selection);
      
      if (isNaN(num) || num < 1 || num > threads.length) {
        print('info', 'Pilihan tidak valid, batal.');
        continue;
      }
      
      const selectedThread = threads[num - 1];
      print('info', `Memuat percakapan: "${selectedThread.title || 'Untitled'}" (ID: ${selectedThread.id})`);
      
      // In a real implementation, we would switch to this thread context
      // For now, we'll just show the conversation and keep current thread
      const { getConversation } = await import('./lib/db.js');
      const history = getConversation(selectedThread.id, 20); // Get last 20 messages
      
      print('info', `Menampilkan ${history.length} pesan terakhir:`);
      history.forEach((entry, index) => {
        if (entry.role === 'user') {
          printUserMessage(entry.content);
        } else if (entry.role === 'assistant') {
          printAssistantMessage(entry.content);
        }
      });
      
      continue;
    }

    // /reset - reset session to initial state
    if (instruction.toLowerCase() === '/reset') {
      print('info', 'Sesi direset. Thread percakapan lama ditutup, membuat thread baru...');
      // Create new conversation thread for this session
      const newThreadId = createThread();
      print('info', `Thread #${newThreadId} dibuat untuk sesi ini.`);
      threadId = newThreadId;
      printSystemMessage(`KIANNNNN aktif. Mode percakapan dimulai.\nKetik pesan kamu atau gunakan /command.\nGunakan /help untuk daftar perintah.`);
      continue;
    }

    // Unknown /command
    if (instruction.startsWith('/')) {
      print('warn', `Command tidak dikenal: "${instruction}".`);
      print('info', 'Ketik /help untuk daftar perintah.');
      continue;
    }

    const intent = await classifyIntent(instruction, askWithFallback);
    dbg('Intent:', intent);

    if (intent === 'casual') {
      const response = await runCasual(instruction);
      // Log ke conversation DB
      logStep({ threadId, role: 'user', content: instruction });
      logStep({ threadId, role: 'assistant', content: response });
      // Print dengan format chat
      printUserMessage(instruction);
      printAssistantMessage(response);
    }
    else if (intent === 'hybrid') {
      // Jawab casual dulu, lalu tanya mau lanjut eksekusi
      const response = await runCasual(instruction);
      // Log ke conversation DB
      logStep({ threadId, role: 'user', content: instruction });
      logStep({ threadId, role: 'assistant', content: response });
      // Print dengan format chat
      printUserMessage(instruction);
      printAssistantMessage(response);
      const cont = await ask('  Mau lanjut eksekusi task? (y/n): ');
      if (cont.trim().toLowerCase() === 'y') {
        await runTask(instruction, agentMd, availableTools, threadId);
      }
    }
    else {
      // Untuk task, tetap gunakan flow original tapi log ke DB
      logStep({ threadId, role: 'user', content: instruction });
      await runTask(instruction, agentMd, availableTools, threadId);
      // History untuk task ditangani di dalam runTask
    }
  }
}

chat().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});
