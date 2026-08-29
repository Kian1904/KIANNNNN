// src/repl.js — Main REPL shell loop and CLI router

import readline from 'readline';
import fs from 'fs';
import { askWithFallback, PROVIDER_NAMES, setModelPrimary, getModelPrimary } from './providers.js';
import { runCasual } from './run-casual.js';
import { runTask } from './run-task.js';
import { discoverTools } from '../mcp/client.js';
import { print, printBlock, printUserMessage, printAssistantMessage, printSystemMessage, header, sep, blank, PROMPT, completer } from './ui.js';
import * as tui from './tui.js';
import { classifyIntent } from './intent.js';
import { readFileSafe, loadAgentMd } from './utils/fs.js';
import { handleModel } from './commands/model.js';
import { handleUsage } from './commands/usage.js';
import { handleConnect } from './commands/connect.js';
import { handleAuth } from './commands/auth.js'; // BARU

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:repl]', ...args); };

// Session allowed (stateful authorization per session)
const sessionAllowed = new Set();

const ALWAYS_ASK_PATTERNS = [
  /\brm\b/, /\bsudo\b/, /\bchmod\b/, /\bdd\b/,
  /\bnpm\s+uninstall\b/, /\bpkg\s+uninstall\b/, /\bkill\b/
];

function isDangerous(command) {
  return ALWAYS_ASK_PATTERNS.some(p => p.test(command));
}

async function startREPL() {
  // Initialize TUI state
  tui.setCursorVisible(false);
  tui.clearScreen();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer
  });

  const ask = (question) => {
    return new Promise(resolve => rl.question(question, resolve));
  };

  const askApproval = async (label, { forceAsk = false } = {}) => {
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
  };

  // Session stats
  const stats = { tasks: 0, llmCalls: 0, byProvider: {}, byAction: {} };
  const trackProvider = (name) => {
    stats.llmCalls++;
    stats.byProvider[name] = (stats.byProvider[name] || 0) + 1;
  };
  const trackAction = (action) => {
    stats.byAction[action] = (stats.byAction[action] || 0) + 1;
  };

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
    const { distillIfNeeded } = await import('./distill.js');
    await distillIfNeeded(askWithFallback);
  } catch (err) {
    print('distill', `Dilewati: ${err.message}`);
  }

  print('info', 'Ketik instruksi. TAB untuk autocomplete /command.');
  blank();

  const { createThread, logStep, getConversation } = await import('./db.js');
  let threadId = createThread();
  print('info', `Thread #${threadId} dibuat untuk sesi ini.`);

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
        const { listSnapshots } = await import('./db.js');
        const snaps = listSnapshots();
        if (snaps.length === 0) {
          print('rollback', 'Belum ada snapshot tersimpan.');
        } else {
          print('rollback', 'File yang punya snapshot:');
          snaps.forEach(s => printBlock(`${s.filepath}  —  ${s.versions} versi, terakhir: ${s.last_snapshot}`, 6));
        }
        continue;
      }

      const { getLatestSnapshot } = await import('./db.js');
      const snap = getLatestSnapshot(filepath);
      if (!snap) {
        print('rollback', `Tidak ada snapshot untuk ${filepath}.`);
        continue;
      }
      const { showDiff } = await import('./diff.js');
      const current = readFileSafe(filepath);
      print('diff', `${filepath}  (current → snapshot ${snap.created_at})`);
      printBlock(showDiff(current === '(file tidak ditemukan)' || current.startsWith('(ACCESS DENIED') ? '' : current, snap.content));
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

    // /auth - BARU
    if (instruction.toLowerCase().startsWith('/auth')) {
      const arg = instruction.split(' ').slice(1).join(' ').trim();
      await handleAuth(arg, ask);
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
        { cmd: '/auth', desc: 'Kelola autentikasi & registrasi provider AI (BARU)' },
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
      const newThreadId = createThread();
      print('info', `Thread #${newThreadId} dibuat untuk sesi ini.`);
      threadId = newThreadId;
      printSystemMessage(`Percakapan direset. Silakan mulai percakapan baru.`);
      continue;
    }

    // /history - show session history from DB
    if (instruction.toLowerCase() === '/history') {
      const history = getConversation(threadId, 50); // Get last 50 messages

      if (history.length === 0) {
        print('info', 'Tidak ada riwayat percakapan di sesi ini.');
      } else {
        print('info', `Menampilkan ${history.length} item riwayat dari thread #${threadId}:`);
        history.forEach((entry) => {
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
      const { updateThreadTitle } = await import('./db.js');
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
      const { getAllThreads } = await import('./db.js');
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

      const history = getConversation(selectedThread.id, 20); // Get last 20 messages
      print('info', `Menampilkan ${history.length} pesan terakhir:`);
      history.forEach((entry) => {
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
      const response = await runCasual(instruction, getConversation(threadId, 10), stats, trackProvider, trackAction);
      logStep({ threadId, role: 'user', content: instruction });
      logStep({ threadId, role: 'assistant', content: response });
      
      // TUI: Show animated chat
      const animOut = await tui.agentChatBox('user', 'You', instruction, false);
      process.stdout.write(animOut);
      const animOut2 = await tui.agentChatBox('assistant', 'KIANNNNN', response, false);
      process.stdout.write(animOut2);
    }
    else if (intent === 'hybrid') {
      const response = await runCasual(instruction, [], stats, trackProvider, trackAction);
      logStep({ threadId, role: 'user', content: instruction });
      logStep({ threadId, role: 'assistant', content: response });
      
      // TUI: Show animated chat
      const animOut = await tui.agentChatBox('user', 'You', instruction, false);
      process.stdout.write(animOut);
      const animOut2 = await tui.agentChatBox('assistant', 'KIANNNNN', response, false);
      process.stdout.write(animOut2);
      const cont = await ask('  Mau lanjut eksekusi task? (y/n): ');
      if (cont.trim().toLowerCase() === 'y') {
        await runTask(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval);
      }
    }
    else {
      logStep({ threadId, role: 'user', content: instruction });
      
      // TUI: Show processing animation sebelum task start
      process.stdout.write(tui.loadingAnimation('memproses task', 3000));
      
      await runTask(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval);
    }
  }
}

// Fungsi untuk menampilkan chat box animasi saat processing
export async function showTypingAnimation(message) {
  const animOutput = await tui.typingAnimation(message, 30);
  process.stdout.write(animOutput);
}

export { startREPL, sessionAllowed };