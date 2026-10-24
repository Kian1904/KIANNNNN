// src/repl.js — Main REPL shell loop and CLI router

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { askWithFallback, PROVIDER_NAMES, setModelPrimary, getModelPrimary } from './providers.js';
import { runCasual } from './run-casual.js';
import { runInstruction, getActiveAgent, setActiveAgent, listAgents, plan, executePlan } from './orchestrator.js';
import { discoverTools } from '../mcp/client.js';
import { print, printBlock, printUserMessage, printAssistantMessage, printSystemMessage, header, sep, blank, PROMPT, completer, banner } from './ui.js';
import { createSquadUiState, applySquadEvent, renderPlainSquad, shouldUseInk } from './squad-ui.js';
import { startInkSquadUi } from './ink-squad-ui.js';
import * as tui from './tui.js';
import { classifyIntent } from './intent.js';
import { readFileSafe, loadAgentMd } from './utils/fs.js';
import { handleModel } from './commands/model.js';
import { handleUsage } from './commands/usage.js';
import { handleConnect } from './commands/connect.js';
import { handleAuth } from './commands/auth.js'; // BARU
import { isDangerous } from './approval.js';
import { MODES, DESTRUCTIVE_ACTIONS, normalizeMode, decide, MODE_DESCRIPTIONS } from './modes.js';
import { routeTask, describeRouting } from './routing.js';
import { reviewPlan, MAX_REPLANS } from './plan-review.js';

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:repl]', ...args); };

// Session allowed (stateful authorization per session)
const sessionAllowed = new Set();

// Mode approval aktif buat sesi ini (default SAFE — semua minta approval).
let approvalMode = normalizeMode(process.env.K_SROUTER_MODE) || MODES.SAFE;

// Auto-routing ke squad: DEFAULT OFF. Aktifin pakai /route on.
// Sengaja opt-in: squad itu N panggilan LLM, gak boleh jalan diam-diam.
let autoRoute = process.env.K_SROUTER_AUTOROUTE === '1';

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
    // ── MODE GATE ────────────────────────────────────────────────────────
    // Destruktif = forceAsk dari command shell (rm/sudo/dd/...), ATAU label-nya
    // sendiri aksi destruktif (delete/rename/move/remove).
    const destructive = forceAsk || DESTRUCTIVE_ACTIONS.has(String(label).toLowerCase());
    const verdict = decide(approvalMode, { action: label, isDestructive: destructive });

    if (verdict.auto) {
      print('auto', `${label} auto-approved (mode: ${approvalMode.toUpperCase()}).`);
      return { approved: true, condition: null };
    }

    // ── Mode SAFE / WELL-WELL + destruktif: tanya manual ────────────────
    if (!forceAsk && sessionAllowed.has(label)) {
      print('auto', `${label} diizinkan untuk sesi ini.`);
      return { approved: true, condition: null };
    }

    if (forceAsk) print('warn', 'Command destruktif — "allow for session" tidak tersedia.');
    if (approvalMode === MODES.WELLWELL) {
      print('warn', 'Aksi destruktif — mode WELL-WELL tetap minta approval.');
    }

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

  const agentList = listAgents();
  banner('0.2.0', modelLabel, agentList.length, availableTools.length);

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
    // `let`, bukan `const` — auto-routing nyuntik prefix /squad ke sini.
    let instruction = input.trim();
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

      // Snapshot file BARU (is_new_file=1): rollback = balik ke kondisi sebelum
      // file dibuat, yaitu file itu TIDAK ADA — hapus, jangan tulis kosong.
      if (snap.is_new_file) {
        if (current === '(file tidak ditemukan)') {
          print('rollback', 'File sudah tidak ada — tidak ada yang perlu di-rollback.');
          continue;
        }
        print('diff', `${filepath}  (file BARU — rollback = hapus file)`);
        printBlock(showDiff(current, ''));
        sep();
        const delConfirm = await ask('  Hapus file ini untuk rollback? (y/n): ');
        if (delConfirm.trim().toLowerCase() === 'y') {
          try {
            fs.unlinkSync(filepath);
            print('rollback', `${filepath} dihapus (kondisi sebelum file dibuat).`);
          } catch (err) {
            print('error', `Gagal menghapus file: ${err.message}`);
          }
        } else {
          print('rollback', 'Dibatalkan.');
        }
        continue;
      }

      print('diff', `${filepath}  (current → snapshot ${snap.created_at})`);
      const currentMissing = current === '(file tidak ditemukan)';

      // Snapshot KOSONG sementara file masih ada = kita gak punya isi asli buat
      // dipulihin. Nulis "" ke disk = MENGHAPUS ISI FILE, bukan rollback.
      // Jangan pernah lakuin itu — lebih baik kasih tau daripada kehilangan data.
      if (!currentMissing && !snap.content) {
        print('rollback', `Snapshot ${snap.created_at} kosong — tidak ada isi untuk dikembalikan.`);
        print('rollback', 'Rollback DIBATALKAN biar isi file sekarang gak ketimpa kosong.');
        continue;
      }

      printBlock(showDiff(currentMissing || current.startsWith('(ACCESS DENIED') ? '' : current, snap.content));
      sep();
      // File HILANG tapi ada snapshot berisi: itu jejak file yang di-DELETE.
      // Rollback = PULIHIN, bukan nulis "(file tidak ditemukan)" ke disk.
      const promptText = currentMissing
        ? '  File sudah tidak ada. Pulihkan dari snapshot? (y/n): '
        : '  Rollback ke snapshot ini? (y/n): ';
      const confirm = await ask(promptText);
      if (confirm.trim().toLowerCase() === 'y') {
        try {
          // Buat direktori induk kalau file aslinya di subfolder yang udah gak ada.
          const parent = path.dirname(filepath);
          if (parent && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
          fs.writeFileSync(filepath, snap.content, 'utf8');
          print('rollback', currentMissing
            ? `${filepath} DIPULIHKAN dari snapshot ${snap.created_at}.`
            : `${filepath} dikembalikan ke snapshot ${snap.created_at}.`);
        } catch (err) {
          print('error', `Gagal tulis ${filepath}: ${err.message}`);
        }
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

    // ── AUTO-ROUTING: task kompleks → squad (kalau diaktifin) ─────────────
    // Ditaruh SEBELUM dispatch /squad manual, jadi task kompleks langsung
    // masuk jalur squad tanpa user ngetik /squad.
    if (autoRoute && !instruction.trim().startsWith('/')) {
      const verdict = routeTask(instruction);
      if (verdict.route === 'squad') {
        print('auto', `Auto-route → squad: ${verdict.reason}`);
        let boleh = true;
        if (verdict.shouldAsk) {
          const a = await askApproval(
            `jalankan SQUAD multi-agent buat task ini`,
            { forceAsk: true }
          );
          boleh = a.approved;
          if (!boleh) print('info', 'Oke, gue kerjain single-agent aja.');
        }
        if (boleh) {
          // Tipu jalur /squad dengan nyuntik prefix — satu jalur eksekusi,
          // gak ada logika squad yang kedobel.
          instruction = '/squad ' + instruction;
        }
      } else {
        print('auto', `Single-agent: ${verdict.reason}`);
      }
    }

    // /agent - pilih/list agent ber-role (PoC multi-agent)
    if (instruction.toLowerCase().startsWith('/agent')) {
      const arg = instruction.split(' ').slice(1).join(' ').trim();
      if (!arg) {
        const active = getActiveAgent();
        print('info', 'Agent tersedia:');
        listAgents().forEach(a => {
          const mark = active && active.name === a.name ? '  [AKTIF]' : '';
          printBlock(`${a.name.padEnd(11)} ${a.label}  —  ${a.description}${mark}`, 2);
        });
        print('info', `Agent aktif: ${active ? active.name : 'generic (default, semua tool)'}`);
        print('info', 'Pakai: /agent <nama>   atau   /agent off (kembali ke generic).');
      } else if (['off', 'default', 'none', 'generic'].includes(arg.toLowerCase())) {
        setActiveAgent(null);
        print('info', 'Balik ke agent generic (semua tool, prompt bawaan).');
      } else {
        try {
          const agent = setActiveAgent(arg.toLowerCase());
          print('info', `Agent aktif: ${agent.name} ${agent.label} — ${agent.description}`);
          print('info', `Aksi diizinkan: ${agent.actions.join(', ')} | maxLoops: ${agent.maxLoops}`);
        } catch (err) {
          print('warn', err.message);
        }
      }
      continue;
    }

    // /help - show available commands
    if (instruction.toLowerCase().startsWith('/mode')) {
      const arg = instruction.trim().split(/\s+/)[1];
      if (!arg) {
        print('info', `Mode approval aktif: ${approvalMode.toUpperCase()}`);
        Object.entries(MODE_DESCRIPTIONS).forEach(([m, d]) => {
          const mark = m === approvalMode ? ' ← aktif' : '';
          printBlock(`${m.toUpperCase().padEnd(10)} ${d}${mark}`);
        });
        print('info', 'ganti: /mode safe | /mode wellwell | /mode yolo');
        continue;
      }
      const next = normalizeMode(arg);
      if (!next) {
        print('warn', `Mode "${arg}" gak dikenal. pilihan: safe, wellwell, yolo.`);
        continue;
      }
      approvalMode = next;
      sessionAllowed.clear(); // mode ganti → izin sesi lama jangan kebawa
      if (next === MODES.YOLO) {
        print('warn', '⚠️  YOLO AKTIF — semua aksi auto-approve, TERMASUK delete/rm/sudo.');
        print('warn', 'Rollback tetap ada buat edit, tapi command shell gak ada jaring pengaman.');
      } else if (next === MODES.WELLWELL) {
        print('session_ok', 'Mode WELL-WELL aktif — edit & bash auto, destruktif tetap ditanya.');
      } else {
        print('info', 'Mode SAFE aktif — semua aksi minta approval.');
      }
      blank();
      continue;
    }

    if (instruction.toLowerCase().startsWith('/route')) {
      const arg = (instruction.trim().split(/\s+/)[1] || '').toLowerCase();
      if (!arg) {
        print('info', `Auto-routing ke squad: ${autoRoute ? 'AKTIF' : 'MATI'}`);
        printBlock('', 2);
        printBlock('Kalau aktif, task kompleks otomatis dikerjakan multi-agent', 2);
        printBlock('tanpa perlu ketik /squad. Task simpel tetap single-agent.', 2);
        printBlock('', 2);
        printBlock('Kontrol: /route on | /route off | /route test <task>', 2);
        continue;
      }
      if (arg === 'on') {
        autoRoute = true;
        print('session_ok', 'Auto-routing AKTIF — task kompleks bakal otomatis ke squad.');
        print('warn', 'Squad = beberapa panggilan LLM. Matiin pakai /route off.');
        continue;
      }
      if (arg === 'off') {
        autoRoute = false;
        print('info', 'Auto-routing MATI — semua task single-agent (kecuali /squad manual).');
        continue;
      }
      if (arg === 'test') {
        // Pakai regex + semua sisa baris, BUKAN split(' ') — biar spasi
        // berlebih dan teks multi-kata gak kepotong salah.
        const sample = instruction.replace(/^\s*\/route\s+test\s+/i, '').trim();
        if (!sample) {
          print('warn', 'Pakai: /route test <contoh task>');
          continue;
        }
        const v = routeTask(sample);
        print('info', `Hasil routing: ${describeRouting(v)}`);
        printBlock(`  confidence : ${v.confidence}`, 2);
        printBlock(`  tanya dulu : ${v.shouldAsk ? 'ya' : 'tidak'}`, 2);
        printBlock(`  sinyal urutan    : ${v.signals.sequences.length}`, 2);
        printBlock(`  sinyal lintas    : ${v.signals.cross.length}`, 2);
        printBlock(`  sinyal riset     : ${v.signals.research.length}`, 2);
        printBlock(`  sinyal review    : ${v.signals.reviews.length}`, 2);
        printBlock(`  task simpel      : ${v.signals.simple ? 'ya' : 'tidak'}`, 2);
        continue;
      }
      print('warn', `Argumen "${arg}" gak dikenal. Pakai: /route on | off | test <task>`);
      continue;
    }

    if (instruction.toLowerCase() === '/help') {
      print('info', 'Daftar perintah yang tersedia:');
      const commands = [
        { cmd: '/help', desc: 'Tampilkan bantuan ini' },
        { cmd: '/exit', desc: 'Keluar dari KIANNNNN' },
        { cmd: '/model', desc: 'Lihat atau ganti model AI' },
        { cmd: '/usage', desc: 'Statistik penggunaan sesi ini' },
        { cmd: '/connect', desc: 'Kelola koneksi MCP (plugin)' },
        { cmd: '/auth', desc: 'Kelola autentikasi & registrasi provider AI (BARU)' },
        { cmd: '/agent', desc: 'Pilih agent ber-role (researcher/coder/reviewer)' },
        { cmd: '/mode', desc: 'Mode approval: safe | wellwell | yolo' },
        { cmd: '/route', desc: 'Auto-routing ke squad: on | off | test <task>' },
        { cmd: '/plan <task>', desc: 'Lihat rencana dekomposisi task (dry-run, tanpa eksekusi)' },
        { cmd: '/squad <task>', desc: 'Jalankan task pakai multi-agent (plan + eksekusi)' },
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

    // /plan <task> — dry-run: tampilkan rencana dekomposisi TANPA eksekusi
    if (instruction.toLowerCase().startsWith('/plan')) {
      const taskText = instruction.split(' ').slice(1).join(' ').trim();
      if (!taskText) {
        print('warn', 'Pakai: /plan <task>  — contoh: /plan riset cara kerja X lalu bikin kodenya');
        continue;
      }
      print('info', 'Membuat rencana (dry-run, tanpa eksekusi)...');
      const p = await plan(taskText, askWithFallback);
      if (!p.ok) {
        print('warn', 'Gagal membuat rencana valid:');
        p.problems.forEach(pr => printBlock(`• ${pr}`, 2));
        continue;
      }
      if (p.tasks.length === 0) {
        print('info', 'Task ini dianggap obrolan, bukan pekerjaan multi-agent.');
        continue;
      }
      print('info', `Rencana (${p.tasks.length} task, ${p.attempts}x percobaan):`);
      const waves = topologicalWaves(p.tasks);
      waves.forEach((wave, wi) => {
        printBlock(`Wave ${wi + 1}:`, 2);
        wave.forEach(t => {
          const dep = t.dependsOn != null ? `  (setelah task ${t.dependsOn})` : '';
          printBlock(`  [${t.id}] ${t.role}: ${t.brief}${dep}`, 4);
        });
      });
      print('info', 'Untuk eksekusi: /squad <task yang sama>');
      continue;
    }

    // /squad <task> — plan + eksekusi multi-agent
    if (instruction.toLowerCase().startsWith('/squad')) {
      const taskText = instruction.split(' ').slice(1).join(' ').trim();
      if (!taskText) {
        print('warn', 'Pakai: /squad <task>  — contoh: /squad riset cara kerja X lalu bikin kodenya');
        continue;
      }

      logStep({ threadId, role: 'user', content: `[SQUAD] ${taskText}` });
      print('info', 'Menganalisis task & menyusun rencana squad...');

      // Gerbang review: susun rencana -> tampilkan -> minta izin -> baru eksekusi.
      // User bisa minta susun ulang sampai MAX_REPLANS kali.
      let p = null;
      let decision = 'cancel';
      let replans = 0;
      for (;;) {
        p = await plan(taskText, askWithFallback);

        if (!p.ok || p.tasks.length === 0) {
          // Fallback: jalankan task generic langsung (perilaku lama), jangan crash
          print('warn', p.ok
            ? 'Task obrolan — jalankan sebagai task biasa.'
            : `Rencana tidak valid (${p.problems[0] || 'unknown'}) — fallback ke single agent.`);
          decision = 'fallback';
          break;
        }

        decision = await reviewPlan(p.tasks, {
          // Sengaja SATU printBlock per baris: formatPlan ngalahin struktur
          // indentasi, dan wrap() di printBlock ngeratain semua indent. Kalau
          // digabung, "boleh: read, list_dir..." nempel ke brief.
          print: (s) => (s === '' ? blank() : printBlock(s, 2)),
          ask,
          planAttempts: p.attempts,
        });

        if (decision !== 'replan') break;
        replans++;
        if (replans >= MAX_REPLANS) {
          print('warn', `Sudah ${replans}x minta susun ulang — berhenti biar gak muter.`);
          decision = 'cancel';
          break;
        }
        print('info', `Menyusun ulang rencana (${replans}/${MAX_REPLANS})...`);
      }

      if (decision === 'cancel') {
        print('info', 'Rencana dibatalkan — tidak ada yang dieksekusi.');
        continue;
      }
      if (decision === 'fallback') {
        await runInstruction(taskText, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval);
        continue;
      }

      sep();
      print('info', 'Rencana disetujui — mulai eksekusi.');

      const squadState = createSquadUiState({ task: taskText, waves: p.tasks ? [p.tasks] : [] });
      const inkMode = shouldUseInk();
      let inkInstance = null;
      const onEvent = event => {
        applySquadEvent(squadState, event);
        if (inkInstance?.rerender) inkInstance.rerender(squadState);
        else if (!inkMode) {
          // Plain fallback hanya menampilkan event penting supaya output gak spam.
          if (event.type === 'agent_error') print('error', `${event.role}: ${event.error}`);
          if (event.type === 'agent_done') print('info', `${event.role} selesai (evidence: ${event.evidence})`);
        }
      };
      if (inkMode) inkInstance = startInkSquadUi(squadState);
      const exec = await executePlan(p, {
        originalInstruction: taskText,
        agentMd, availableTools, threadId,
        stats, trackProvider, trackAction, isDangerous, askApproval,
      }, { onEvent });
      if (inkInstance?.unmount) inkInstance.unmount();

      sep();
      print('done', 'Ringkasan akhir squad:');
      printBlock(exec.finalSummary);
      blank();
      logStep({ threadId, role: 'assistant', content: exec.finalSummary, actionType: 'done', approved: true });
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
        await runInstruction(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval);
      }
    }
    else {
      logStep({ threadId, role: 'user', content: instruction });
      
      // TUI: Show processing animation sebelum task start
      process.stdout.write(await tui.loadingAnimation('memproses task', 3000));
      
      await runInstruction(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval);
    }
  }
}

// Fungsi untuk menampilkan chat box animasi saat processing
export async function showTypingAnimation(message) {
  const animOutput = await tui.typingAnimation(message, 30);
  process.stdout.write(animOutput);
}

export { startREPL, sessionAllowed };