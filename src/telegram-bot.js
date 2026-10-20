// src/telegram-bot.js — Jembatan Telegram (mode polling) ke agent K-sRouter.
//
// M17 (perombakan): bot ini SEBELUMNYA cuma manggil runTask telanjang —
// gak nyambung orchestrator (no /agent /plan /squad) DAN crash
// "askApproval is not a function" tiap agent minta edit/bash karena
// parameter approval gak pernah dikirim. Sekarang:
//   - Semua instruksi lewat runInstruction (orchestrator) — agent aktif
//     yang dipakai, persis kayak REPL.
//   - /agent /plan /squad /stats /clear /help setara REPL.
//   - Approval via BALASAN CHAT: y (sekali) / s (sesi) / n (tolak)
//     / c <kondisi> — timeout APPROVAL_TIMEOUT_MS otomatis ditolak.
//   - Polling TIDAK PERNAH mati nunggu jawaban approval: handleMessage
//     fire-and-forget, jawaban approval dicek PERTAMA di urutan pesan.
//   - Factory createTelegramBot(deps) — semua dependency bisa di-inject,
//     jadi test jalan offline tanpa LLM/network.
//
// Polling (bukan webhook) — sengaja: gak butuh IP publik, tetap jalan
// di data seluler / Termux.
//
// Written by K-sRouter

import 'dotenv/config';
import { pathToFileURL } from 'url';
import { createThread, logStep, getConversation } from './db.js';
import { runInstruction, getActiveAgent, setActiveAgent, listAgents, plan, executePlan } from './orchestrator.js';
import { runCasual } from './run-casual.js';
import { classifyIntent } from './intent.js';
import { discoverTools } from '../mcp/client.js';
import { loadAgentMd } from './utils/fs.js';
import { isDangerous } from './approval.js';
import { MODES, DESTRUCTIVE_ACTIONS, normalizeMode, decide, MODE_DESCRIPTIONS } from './modes.js';

/** Waktu tunggu jawaban approval sebelum otomatis ditolak (ms). */
export const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * True kalau teks pesan layak diproses sebagai JAWABAN approval
 * (bukan instruksi baru). Dipakai pola ketat — sisanya kena reminder.
 * @param {string} text
 * @returns {boolean}
 */
export function isApprovalAnswer(text) {
  const t = (text || '').trim().toLowerCase();
  if (/^(y|yes|n|no|s)$/.test(t)) return true;
  if (/^c\s+\S/.test(t)) return true;
  return false;
}

const HELP_TEXT = `🤖 K-sRouter Bot — perintah:
/agent — lihat agent aktif
/agent <nama> — pilih agent: ${Object.keys({}).join('')}
/plan <task> — lihat rencana squad TANPA eksekusi
/squad <task> — eksekusi multi-agent (plan → wave → ringkasan)
/stats — statistik sesi ini
/clear — mulai thread baru
/help — bantuan ini

Izin aksi file/shell: balas y (sekali), s (sesi), n (tolak), atau c <kondisi>.`;

/**
 * Bikin instance bot Telegram. Semua dependency di-inject supaya bisa
 * di-test offline (test-telegram.mjs) tanpa mengubah perilaku produksi —
 * default-nya memakai modul asli.
 *
 * @param {Object} deps
 * @param {string} deps.botToken
 * @param {string[]} [deps.allowedUserIds]
 * @param {Function} [deps.fetchFn] - default fetch asli
 * @param {number} [deps.approvalTimeoutMs]
 * @param {Function} [deps.createThread|logStep|getConversation|runInstruction|
 *                      getActiveAgent|setActiveAgent|listAgents|plan|executePlan|
 *                      runCasual|classifyIntent|discoverTools|loadAgentMd|isDangerous]
 * @returns {{handleMessage:Function, startPolling:Function, stop:Function,
 *            askApproval:Function, _state:Object}}
 */
export function createTelegramBot({
  botToken,
  allowedUserIds = [],
  fetchFn = (...a) => fetch(...a),
  approvalTimeoutMs = APPROVAL_TIMEOUT_MS,
  createThread: mkThread = createThread,
  logStep: log = logStep,
  getConversation: getConv = getConversation,
  runInstruction: runInstr = runInstruction,
  getActiveAgent: getActive = getActiveAgent,
  setActiveAgent: setActive = setActiveAgent,
  listAgents: listAgentsFn = listAgents,
  plan: planFn = plan,
  executePlan: execFn = executePlan,
  runCasual: casualFn = runCasual,
  classifyIntent: classifyFn = classifyIntent,
  discoverTools: toolsFn = discoverTools,
  loadAgentMd: agentMdFn = loadAgentMd,
  isDangerous: dangerFn = isDangerous,
} = {}) {
  if (!botToken) throw new Error('botToken wajib diisi.');

  const apiBase = `https://api.telegram.org/bot${botToken}`;
  const helpText = HELP_TEXT.replace(
    '/agent <nama> — pilih agent: ',
    `/agent <nama> — pilih agent: ${listAgentsFn().map(a => a.name).join('|')}`
  );

  let offset = 0;
  let threadId = null;
  let running = false;      // satu task besar dalam satu waktu (single-user bot)
  let stopped = false;
  /** @type {null|{chatId:number,label:string,forceAsk:boolean,timer:any,resolve:Function}} */
  let pendingApproval = null;

  const stats = { tasks: 0, llmCalls: 0, byProvider: {}, byAction: {} };
  const trackProvider = (name) => { stats.llmCalls++; stats.byProvider[name] = (stats.byProvider[name] || 0) + 1; };
  const trackAction = (action) => { stats.byAction[action] = (stats.byAction[action] || 0) + 1; };
  const sessionAllowed = new Set();

  // Mode approval buat sesi bot ini (default SAFE, bisa dari env).
  let approvalMode = normalizeMode(process.env.K_SROUTER_MODE) || MODES.SAFE;

  /** @param {number} chatId @param {string} text */
  async function sendMessage(chatId, text) {
    const chunks = (text || '').match(/[\s\S]{1,4000}/g) || [''];
    for (const chunk of chunks) {
      await fetchFn(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
    }
  }

  /** Approval ala REPL, tapi nunggu balasan chat (y/s/n/c). */
  function makeAskApproval(chatId) {
    return async (label, { forceAsk = false } = {}) => {
      // MODE GATE — sama persis dengan aturan di REPL (src/modes.js).
      const destructive = forceAsk || DESTRUCTIVE_ACTIONS.has(String(label).toLowerCase());
      const verdict = decide(approvalMode, { action: label, isDestructive: destructive });

      if (verdict.auto) {
        await sendMessage(chatId, `[auto] ${label} auto-approved (mode: ${approvalMode.toUpperCase()})`);
        return { approved: true, condition: null };
      }

      if (!forceAsk && sessionAllowed.has(label)) {
        return { approved: true, condition: null };
      }
      const opts = forceAsk
        ? 'y (izinkan) | n (tolak) | c <kondisi>'
        : 'y (sekali) | s (sesi) | n (tolak) | c <kondisi>';
      await sendMessage(
        chatId,
        `⚠️ IZIN: ${label}${forceAsk ? ' — perintah destruktif, "s" tidak tersedia' : ''}\n` +
        `Balas: ${opts}\n⏰ ${Math.round(approvalTimeoutMs / 1000)}s → otomatis ditolak`
      );
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          if (pendingApproval && pendingApproval.resolve === wrapped) pendingApproval = null;
          sendMessage(chatId, '⏰ Waktu izin habis — otomatis ditolak.').catch(() => {});
          resolve({ approved: false, condition: null });
        }, approvalTimeoutMs);
        const wrapped = (answer) => {
          clearTimeout(timer);
          if (pendingApproval && pendingApproval.resolve === wrapped) pendingApproval = null;
          resolve(answer);
        };
        pendingApproval = { chatId, label, forceAsk, timer, resolve: wrapped };
      });
    };
  }

  /**
   * Proses teks sebagai JAWABAN approval (dipanggil PERTAMA sebelum
   * busy-check, supaya jawaban gak nyangkut di belakang task yang nunggu).
   * @returns {boolean} true kalau teks terkonsumsi sebagai jawaban
   */
  function answerApproval(text) {
    const p = pendingApproval;
    if (!p) return false;
    const t = (text || '').trim().toLowerCase();
    if (/^(y|yes)$/.test(t)) { p.resolve({ approved: true, condition: null }); return true; }
    if (/^(n|no)$/.test(t)) { p.resolve({ approved: false, condition: null }); return true; }
    if (t === 's') {
      if (p.forceAsk) {
        sendMessage(p.chatId, 'Perintah destruktif tidak bisa "sesi". Balas y atau n.').catch(() => {});
        return true; // terkonsumsi, TAPI approval tetap nunggu pilihan valid
      }
      sessionAllowed.add(p.label);
      p.resolve({ approved: true, condition: null });
      return true;
    }
    if (/^c\s+\S/.test(t)) {
      p.resolve({ approved: true, condition: text.trim().slice(2).trim() });
      return true;
    }
    return false;
  }

  async function handleCommand(chatId, text) {
    const cmd = text.slice(1).split(/\s+/)[0].toLowerCase();
    const arg = text.slice(1 + cmd.length).trim();

    if (cmd === 'start' || cmd === 'help') return sendMessage(chatId, helpText);

    if (cmd === 'agent') {
      if (!arg) {
        const active = getActive();
        return sendMessage(chatId, active
          ? `🧠 Agent aktif: ${active.name} — ${active.description}`
          : '🧠 Mode: generic (belum pilih agent). Ketik /agent <nama>.');
      }
      if (['off', 'generic', 'default'].includes(arg.toLowerCase())) {
        setActive(null);
        return sendMessage(chatId, 'Mode generic aktif (perilaku single-agent).');
      }
      try {
        const a = setActive(arg);
        return sendMessage(chatId, `✅ Agent aktif: ${a.name}\n${a.description}\nAksi: ${a.actions.join(', ')}`);
      } catch (err) {
        return sendMessage(chatId, `❌ ${err.message}`);
      }
    }

    if (cmd === 'plan') {
      if (!arg) return sendMessage(chatId, 'Pakai: /plan <task> — contoh: /plan riset cara kerja X lalu bikin kodenya');
      const p = await planFn(arg);
      if (!p.ok) return sendMessage(chatId, `❌ Rencana tidak valid:\n${p.problems.map(x => `- ${x}`).join('\n')}`);
      if (p.tasks.length === 0) return sendMessage(chatId, 'Task obrolan — tidak perlu squad. Langsung chat saja.');
      const lines = p.tasks.map(t => `${t.id}. [${t.role}] ${t.brief}${t.dependsOn != null ? ` (butuh #${t.dependsOn})` : ''}`);
      return sendMessage(chatId, `📋 Rencana (${p.tasks.length} task):\n\n${lines.join('\n')}\n\nUntuk eksekusi: /squad ${arg}`);
    }

    if (cmd === 'squad') {
      if (!arg) return sendMessage(chatId, 'Pakai: /squad <task> — contoh: /squad riset cara kerja X lalu bikin kodenya');
      log({ threadId: getThreadId(), role: 'user', content: `[SQUAD] ${arg}` });
      const p = await planFn(arg);
      if (!p.ok || p.tasks.length === 0) {
        // Fallback persis REPL: jalankan sebagai task single-agent biasa
        const result = await runSingle(arg, chatId);
        return sendMessage(chatId, result);
      }
      await sendMessage(chatId, `🚀 Squad: ${p.tasks.length} task → ${p.tasks.map(t => `${t.role}(#${t.id})`).join(' → ')}`);
      const exec = await execFn(p, {
        originalInstruction: arg,
        agentMd: agentMdFn(), availableTools: await toolsFn().catch(() => []),
        threadId: getThreadId(),
        stats, trackProvider, trackAction, isDangerous: dangerFn,
        askApproval: makeAskApproval(chatId),
      });
      log({ threadId: getThreadId(), role: 'assistant', content: exec.finalSummary, actionType: 'done', approved: true });
      return sendMessage(chatId, `✅ Ringkasan squad:\n\n${exec.finalSummary}`);
    }

    if (cmd === 'mode') {
      if (!arg) {
        const lines = Object.entries(MODE_DESCRIPTIONS)
          .map(([m, d]) => `${m === approvalMode ? '[x]' : '[ ]'} ${m.toUpperCase()} - ${d}`);
        return sendMessage(chatId, `Mode approval aktif: ${approvalMode.toUpperCase()}\n\n${lines.join('\n')}\n\nGanti: /mode safe | /mode wellwell | /mode yolo`);
      }
      const next = normalizeMode(arg);
      if (!next) return sendMessage(chatId, `Mode "${arg}" gak dikenal. Pilihan: safe, wellwell, yolo.`);
      approvalMode = next;
      sessionAllowed.clear();
      if (next === MODES.YOLO) {
        return sendMessage(chatId, 'YOLO AKTIF - semua aksi auto-approve, TERMASUK delete/rm/sudo.\nRollback tetap ada buat edit; command shell gak ada jaring pengaman.');
      }
      if (next === MODES.WELLWELL) {
        return sendMessage(chatId, 'Mode WELL-WELL aktif - edit & bash auto-approve, destruktif (delete/rename/remove, rm/sudo/dd/kill) TETAP ditanya.');
      }
      return sendMessage(chatId, 'Mode SAFE aktif - semua aksi minta approval satu-satu.');
    }

    if (cmd === 'stats') {
      const prov = Object.entries(stats.byProvider).map(([k, v]) => `${k}=${v}`).join(', ') || '—';
      const act = Object.entries(stats.byAction).map(([k, v]) => `${k}=${v}`).join(', ') || '—';
      return sendMessage(chatId, `📊 Sesi ini:\nLLM call: ${stats.llmCalls} (${prov})\nAksi: ${act}`);
    }

    if (cmd === 'clear') {
      threadId = mkThread();
      return sendMessage(chatId, `Thread baru (#${threadId}) — percakapan direset.`);
    }

    return sendMessage(chatId, `Perintah tidak dikenal: /${cmd}\n\n${helpText}`);
  }

  /** Task biasa lewat runInstruction (pakai agent aktif) — hasil dibalikin sebagai teks. */
  async function runSingle(text, chatId) {
    const result = await runInstr(
      text, agentMdFn(), await toolsFn().catch(() => []), getThreadId(),
      stats, trackProvider, trackAction, dangerFn, makeAskApproval(chatId)
    );
    return (typeof result === 'string' && result.trim()) || 'Task selesai.';
  }

  function getThreadId() {
    if (threadId === null) threadId = mkThread();
    return threadId;
  }

  /** @param {{chat:{id:number}, from:{id:number|string}, text?:string}} msg */
  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? '');
    const text = msg.text || '';

    if (allowedUserIds.length > 0 && !allowedUserIds.includes(userId)) {
      console.log(`[telegram-bot] Pesan dari user_id ${userId} DITOLAK (allowlist).`);
      return; // diamkan — jangan kasih tau ini bot privat
    }

    // 1) Jawaban approval masuk PERTAMA — harus jalan walau task masih nunggu,
    //    kalau tidak: deadlock (polling gak nunggu, task nunggu jawaban).
    if (pendingApproval && isApprovalAnswer(text)) { answerApproval(text); return; }

    // 2) Ada izin nunggu tapi bukan jawaban valid → reminder, jangan diproses.
    if (pendingApproval) {
      return sendMessage(chatId, `⏳ Izin "${pendingApproval.label}" masih menunggu balasan: y / s / n / c <kondisi>`);
    }

    // 3) Satu task besar dalam satu waktu (single-user bot).
    if (running) return sendMessage(chatId, '⏳ Masih memproses pesan sebelumnya — tunggu bentar ya.');

    running = true;
    try {
      console.log(`[telegram-bot] Pesan dari ${userId}: ${text}`);
      log({ threadId: getThreadId(), role: 'user', content: text });

      if (text.startsWith('/')) return await handleCommand(chatId, text.trim());

      const availableTools = await toolsFn().catch(() => []);
      const agentMd = agentMdFn();
      const intent = await classifyFn(text);

      if (intent === 'casual') {
        const response = await casualFn(text, getConv(getThreadId(), 10), stats, trackProvider, trackAction);
        await sendMessage(chatId, response);
      } else {
        const result = await runSingle(text, chatId);
        await sendMessage(chatId, result);
      }
    } catch (err) {
      console.error('[telegram-bot] Error:', err);
      await sendMessage(chatId, `Terjadi error: ${err.message}`).catch(() => {});
    } finally {
      running = false;
    }
  }

  /** Long-polling loop. handleMessage fire-and-forget: loop getUpdates
   *  TIDAK PERNAH berhenti nunggu approval/task — jawaban approval
   *  justru datang lewat loop ini. */
  async function startPolling() {
    if (!botToken) {
      console.error('[telegram-bot] TELEGRAM_BOT_TOKEN belum di-set di .env. Berhenti.');
      process.exit(1);
    }
    getThreadId(); // bikin thread sesi sekali di awal
    console.log(`[telegram-bot] Thread #${threadId} — mulai polling...`);
    stopped = false;
    while (!stopped) {
      try {
        const res = await fetchFn(`${apiBase}/getUpdates?offset=${offset}&timeout=30`);
        const data = await res.json();
        if (data.ok && data.result?.length > 0) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            if (update.message) handleMessage(update.message).catch(err => console.error('[telegram-bot]', err.message));
          }
        }
      } catch (err) {
        console.error('[telegram-bot] Polling error (retry 5s):', err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  function stop() { stopped = true; }

  return { handleMessage, startPolling, stop, makeAskApproval, answerApproval, sendMessage,
           get _state() { return { offset, threadId, pendingApproval, stats, running }; } };
}

// ── Entry point (jalankan: node src/telegram-bot.js) ─────────────────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const ALLOWED_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!BOT_TOKEN) {
    console.error('[telegram-bot] TELEGRAM_BOT_TOKEN belum di-set di .env. Berhenti.');
    process.exit(1);
  }
  const bot = createTelegramBot({ botToken: BOT_TOKEN, allowedUserIds: ALLOWED_USER_IDS });
  bot.startPolling();
}
