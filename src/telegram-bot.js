// src/telegram-bot.js — Jembatan Telegram (mode polling) ke agent K-sRouter-CLI.
// Manggil runTask/runCasual yang SAMA kayak yang dipake REPL terminal, dan
// pakai db.js yang SAMA — jadi memory (conversations/thread/decisions) tetap
// nyambung, gak peduli lo akses lewat terminal atau Telegram.
//
// Polling (bukan webhook) — sengaja dipilih karena gak butuh IP publik,
// jadi tetap jalan di data seluler / Termux tanpa perlu VPS/Render/dst.

import 'dotenv/config';
import { createThread, logStep, getConversation } from './db.js';
import { runTask } from './run-task.js';
import { runCasual } from './run-casual.js';
import { classifyIntent } from './intent.js';
import { discoverTools } from '../mcp/client.js';
import { loadAgentMd } from './utils/fs.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error('[telegram-bot] TELEGRAM_BOT_TOKEN belum di-set di .env. Berhenti.');
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0; // penanda "pesan terakhir yang udah diproses" buat long polling

// Thread terpisah khusus buat sesi Telegram — gak nyampur sama sesi terminal,
// tapi tetap baca dari database yang sama (memory & history tetap nyambung).
const threadId = createThread();
console.log(`[telegram-bot] Thread #${threadId} dibuat untuk sesi Telegram.`);

/** @param {string} chatId @param {string} text */
async function sendMessage(chatId, text) {
  // Telegram batasin ~4096 karakter per pesan — potong kalau kepanjangan.
  const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
  for (const chunk of chunks) {
    await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk })
    });
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text || '';

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(userId)) {
    console.log(`[telegram-bot] Pesan dari user_id ${userId} DITOLAK (tidak ada di allowlist).`);
    return; // diamkan saja, jangan kasih tau siapapun ini bot privat
  }

  console.log(`[telegram-bot] Pesan masuk dari ${userId}: ${text}`);
  logStep({ threadId, role: 'user', content: text });

  try {
    const availableTools = await discoverTools().catch(() => []);
    const agentMd = loadAgentMd();
    const intent = await classifyIntent(text);

    let response;
    if (intent === 'casual') {
      response = await runCasual(text, getConversation(threadId, 10));
      await sendMessage(chatId, response);
    } else {
      // runTask sendiri yang nge-print ke console & logStep tiap langkah;
      // di sini kita cuma perlu nangkep SUMMARY akhir buat dikirim ke Telegram.
      // Asumsi runTask() menerima callback opsional — kalau belum ada,
      // paling gampang: bungkus console.log sementara buat nangkep output.
      const originalLog = console.log;
      let captured = '';
      console.log = (...args) => {
        captured += args.join(' ') + '\n';
        originalLog(...args);
      };
      await runTask(text, agentMd, availableTools, threadId);
      console.log = originalLog;
      await sendMessage(chatId, captured || 'Task selesai (tidak ada output ditangkap).');
    }
  } catch (err) {
    console.error('[telegram-bot] Error:', err);
    await sendMessage(chatId, `Terjadi error: ${err.message}`);
  }
}

async function pollLoop() {
  while (true) {
    try {
      const res = await fetch(`${API_BASE}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message) await handleMessage(update.message);
        }
      }
    } catch (err) {
      console.error('[telegram-bot] Polling error (lanjut coba lagi):', err.message);
      await new Promise(r => setTimeout(r, 5000)); // tunggu sebentar sebelum retry
    }
  }
}

console.log('[telegram-bot] Mulai polling...');
pollLoop();
