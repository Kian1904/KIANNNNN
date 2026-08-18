const SYSTEM_PROMPT = `Kamu agent otonom yang ngerjain task step-by-step. Tiap giliran,
kamu pilih SATU aksi berikutnya berdasarkan history langkah sebelumnya (kalau ada).
Kalau task udah selesai, pilih ACTION: done.

Balas PERSIS salah satu dari 3 format ini, tanpa markdown fence, tanpa teks lain:

Format edit file:
REASONING: <alasan singkat>
ACTION: edit
TARGET: <nama file>
===CONTENT_START===
<isi LENGKAP file setelah diedit>
===CONTENT_END===

Format jalanin command:
REASONING: <alasan singkat>
ACTION: bash
COMMAND: <satu baris shell command>

Format selesai:
REASONING: <alasan singkat>
ACTION: done
SUMMARY: <ringkasan apa yang udah dicapai>`;

function buildHistoryText(history) {
  if (history.length === 0) return '(belum ada langkah)';
  return history.map((h, i) => {
    if (h.action === 'edit') {
      return `Langkah ${i + 1}: EDIT ${h.target} — ${h.approved ? 'diterapkan' : 'DITOLAK user'}`;
    }
    return `Langkah ${i + 1}: BASH "${h.command}" — ${h.approved ? `exit ${h.result.code}, stdout: ${h.result.stdout.slice(0, 300)}` : 'DITOLAK user'}`;
  }).join('\n');
}

export async function planStep(askFn, { instruction, fileSnapshot, history }) {
  const userPrompt = `Task: ${instruction}

Isi file saat ini (kalau relevan):
---
${fileSnapshot}
---

History langkah sebelumnya di task ini:
${buildHistoryText(history)}

Tentuin langkah berikutnya.`;

  const raw = await askFn(SYSTEM_PROMPT, userPrompt);

  const reasoningMatch = raw.match(/REASONING:\s*(.*)/);
  const actionMatch = raw.match(/ACTION:\s*(edit|bash|done)/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : '(tidak ada alasan)';

  if (!actionMatch) {
    throw new Error(`Respons LLM tidak punya ACTION yang valid.\n--- raw ---\n${raw}`);
  }
  const action = actionMatch[1];

  if (action === 'done') {
    const summaryMatch = raw.match(/SUMMARY:\s*(.*)/);
    return { action, reasoning, summary: summaryMatch ? summaryMatch[1].trim() : '' };
  }

  if (action === 'bash') {
    const commandMatch = raw.match(/COMMAND:\s*(.*)/);
    if (!commandMatch) throw new Error(`ACTION bash tapi tidak ada COMMAND.\n--- raw ---\n${raw}`);
    return { action, reasoning, command: commandMatch[1].trim() };
  }

  // action === 'edit'
  const targetMatch = raw.match(/TARGET:\s*(.*)/);
  const startIdx = raw.indexOf('===CONTENT_START===');
  const endIdx = raw.indexOf('===CONTENT_END===');
  if (!targetMatch || startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`ACTION edit tapi format TARGET/CONTENT tidak lengkap.\n--- raw ---\n${raw}`);
  }
  const newContent = raw
    .slice(startIdx + '===CONTENT_START==='.length, endIdx)
    .replace(/^\n/, '')
    .replace(/\n$/, '');

  return { action, reasoning, target: targetMatch[1].trim(), new_content: newContent };
}
