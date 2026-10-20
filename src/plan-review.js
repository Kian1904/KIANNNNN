// src/plan-review.js — Preview rencana + gerbang review sebelum eksekusi.
//
// Kenapa ada: dulu `/squad <task>` langsung ngeksekusi. User cuma liat satu
// baris "Rencana: researcher(#1) → coder(#2)" lalu agent-nya udah ngutak-ngatik
// file. Padahal rencana itulah keputusan paling penting di seluruh alur —
// salah rencana = salah semuanya, dan yang bayar ongkosnya user.
//
// Di sini rencana ditampilin UTUH dulu (tiap task: role, brief, urutan), user
// bisa setuju / batal / minta LLM nyusun ulang. Editing manual per-task sengaja
// TIDAK ada — kalau user mau ubah, lebih jujur minta susun ulang daripada kita
// nempelin teks ke struktur yang mungkin udah nggak konsisten.

import { AGENTS } from './agents.js';
import { topologicalWaves } from './orchestrator.js';

/**
 * Susun representasi teks rencana — dipakai bareng oleh REPL & Telegram.
 *
 * @param {Array} tasks - hasil plan() yang sudah tervalidasi
 * @returns {string[]} baris-baris siap ditampilkan (tanpa warna/emoji platform)
 */
export function formatPlan(tasks) {
  const lines = [];
  let waves;
  try {
    waves = topologicalWaves(tasks);
  } catch (err) {
    // Rencana yang gak bisa di-topo-sort = masalah nyata, jangan disembunyiin.
    return [`RENCANA BERMASALAH: ${err.message}`];
  }

  lines.push(`${tasks.length} task dalam ${waves.length} wave:`);
  waves.forEach((wave, wi) => {
    lines.push(`Wave ${wi + 1}${wave.length > 1 ? ` (${wave.length} task bisa jalan paralel)` : ''}:`);
    wave.forEach(t => {
      const agent = AGENTS[t.role];
      const icon = agent ? agent.label : `❓ ${t.role}`;
      const dep = t.dependsOn != null ? `   ← setelah task ${t.dependsOn}` : '';
      lines.push(`  [${t.id}] ${icon}${dep}`);
      lines.push(`      ${t.brief}`);
      if (agent && Array.isArray(agent.actions)) {
        lines.push(`      boleh: ${agent.actions.join(', ')}`);
      }
    });
  });
  return lines;
}

/**
 * Gerbang review: tampilkan rencana, tanya user.
 *
 * Tiga jawaban:
 *   'y'  -> setuju, lanjut eksekusi
 *   'n'  -> batal total, jangan sentuh apa pun
 *   'r'  -> susun ulang (pemanggil yang manggil plan() lagi)
 *
 * Fail-closed: jawaban apa pun di luar 'y' TIDAK dieksekusi. Lebih baik user
 * harus ngetik ulang daripada agent jalan tanpa izin yang jelas.
 *
 * @param {Array} tasks
 * @param {Object} io
 * @param {(s:string)=>void} io.print
 * @param {()=>Promise<string>} io.ask
 * @param {number} [io.planAttempts] - berapa kali LLM nyoba nyusun rencana ini
 * @returns {Promise<'execute'|'cancel'|'replan'>}
 */
export async function reviewPlan(tasks, { print, ask, planAttempts = 1 }) {
  print('');
  print(`RENCANA (${planAttempts > 1 ? `${planAttempts}x percobaan LLM, ` : ''}belum dieksekusi):`);
  formatPlan(tasks).forEach(l => print(l));
  print('');
  const answer = (await ask('  Jalankan rencana ini? (y = jalankan / r = susun ulang / n = batal): '))
    .trim()
    .toLowerCase();

  if (answer === 'y' || answer === 'ya' || answer === 'yes') return 'execute';
  if (answer === 'r' || answer === 're' || answer === 'ulang') return 'replan';
  // Termasuk 'n' dan semua ketikan ngawur -> batal. Fail-closed.
  return 'cancel';
}

/**
 * Batas berapa kali user boleh minta "susun ulang" sebelum kita berhenti.
 * Tanpa batas, user yang gak sengaja ngetik 'r' terus = loop LLM tanpa ujung.
 */
export const MAX_REPLANS = 3;

/**
 * Cara aman nampilin rencana di Telegram: satu pesan, dipotong kalau kepanjangan.
 * @param {Array} tasks
 * @param {number} [limit] - batas karakter per pesan Telegram (4096 default)
 * @returns {string}
 */
export function formatPlanForTelegram(tasks, limit = 3500) {
  const body = formatPlan(tasks)
    .map(l => (l.startsWith('    ') ? `• ${l.trim()}` : l))
    .join('\n');
  if (body.length <= limit) return body;
  return body.slice(0, limit) + `\n… (${body.length - limit} karakter lagi kepotong)`;
}
