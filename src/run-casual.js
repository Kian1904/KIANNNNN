// src/run-casual.js — Handler percakapan santai (casual reply)

import { askWithFallback, fallbackState } from './providers.js';
import { printBlock, blank } from './ui.js';

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
    const reply = await askWithFallback(CASUAL_SYSTEM, instruction);
    blank();
    printBlock(reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
    blank();
    
    if (trackProvider) trackProvider(fallbackState.lastProvider);
    if (trackAction) trackAction('casual');
    
    return reply; // Return the reply so it can be added to session history
  } catch (err) {
    throw new Error(`Gagal casual: ${err.message}`);
  }
}
