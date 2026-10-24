// src/run-casual.js — Handler percakapan santai (casual reply)

import { askWithFallback, fallbackState } from './providers.js';
import { printBlock, blank } from './ui.js';
import { readEnv } from './env.js';

// Mode streaming: set K_STREAM=0 buat matiin (fallback ke print sekali).
const STREAM_ENABLED = readEnv('STREAM') !== '0';

/**
 * Jalankan chat casual (santai) tanpa ReAct loop
 * @param {string} instruction
 * @param {Array} history
 * @param {Object} stats
 * @param {Function} trackProvider
 * @param {Function} trackAction
 * @returns {Promise<string>}
 */
export async function runCasual(instruction, history = [], stats, trackProvider, trackAction) {
  const historyText = history.length > 0
    ? 'Context percakapan sebelumnya:\n' + history.map(h => `${h.role}: ${h.content}`).join('\n') + '\n\n' : '';

  const CASUAL_SYSTEM = `Kamu asisten AI yang helpful dan natural. Jawab dengan santai dan langsung — tidak perlu format khusus, tidak perlu list kecuali memang relevan. Gunakan bahasa yang sama dengan user.${historyText ? `\n\n${historyText}` : ''}`;

  try {
    let reply;
    blank();

    if (STREAM_ENABLED) {
      // Streaming: teks muncul kata-per-kata. `thinking` dibuang real-time —
      // kita tahan sampai ketemu penanda akhir think, sisanya baru dicetak.
      let started = false;   // sudah lewat blok thinking?
      let raw = '';          // akumulasi buat deteksi tag thinking

      const flush = (text) => { if (text) process.stdout.write(text); };

      reply = await askWithFallback(CASUAL_SYSTEM, instruction, {
        onToken: (t) => {
          raw += t;
          if (started) { flush(t); return; }

          // Belum lewat thinking: cek apakah sudah ada '</think>'.
          const closeIdx = raw.search(/<\/think>/i);
          if (closeIdx !== -1) {
            started = true;
            const after = raw.slice(closeIdx + '</think>'.length).replace(/^\s+/, '');
            if (after) flush(after);
            return;
          }
          // Kalau >600 char dan gak pernah ada tag thinking, anggap gak ada
          // blok thinking — langsung cetak semuanya (hindari output nyangkut).
          if (raw.length > 600 && !/<think>/i.test(raw)) {
            started = true;
            flush(raw);
          }
        },
      });

      // Sisa yang belum tercetak (kalau model gak pernah nulis </think>)
      if (!started) {
        const cleaned = raw.replace(/<think[\s\S]*?<\/think>/gi, '').trim();
        flush(cleaned);
      }
      process.stdout.write('\n');
    } else {
      reply = await askWithFallback(CASUAL_SYSTEM, instruction);
      printBlock(reply.replace(/<think[\s\S]*?<\/think>/gi, '').trim());
    }

    blank();

    if (trackProvider) trackProvider(fallbackState.lastProvider);
    if (trackAction) trackAction('casual');

    return reply; // Return the reply so it can be added to session history
  } catch (err) {
    throw new Error(`Gagal casual: ${err.message}`);
  }
}
