const SYSTEM_PROMPT = `Kamu agent otonom yang ngerjain task step-by-step. Tiap giliran,
kamu pilih SATU aksi berikutnya berdasarkan history langkah sebelumnya (kalau ada).
jika input user adalah salam, obrolan biasa, atau pertanyaan non-teknis yang tidak butuh aksi apapun — langsung balas ACTION: done dengan SUMMARY yang sesuai. Jangan explore codebase hanya karena input tidak jelas.

Balas PERSIS salah satu dari 6 format ini, tanpa markdown fence, tanpa teks lain:

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

Format baca isi file:
REASONING: <alasan singkat>
ACTION: read
TARGET: <path file yang mau dibaca>

Format list isi direktori:
REASONING: <alasan singkat>
ACTION: list_dir
TARGET: <path direktori, atau . untuk current directory>

Format selesai:
REASONING: <alasan singkat>
ACTION: done
SUMMARY: <ringkasan apa yang udah dicapai>

Format simpan keputusan ke memory:
REASONING: <alasan singkat>
ACTION: remember
KEY: <identifier singkat snake_case, contoh: prefer_esm_import>
VALUE: <keputusan yang perlu diingat lintas sesi>`

function buildHistoryText(history) {
  if (history.length === 0) return '(belum ada langkah)';
  return history.map((h, i) => {
    if (h.action === 'read') {
      return `Langkah ${i + 1}: READ ${h.target}\n--- ISI FILE ---\n${h.content}\n--- END ---`;
    }
    if (h.action === 'list_dir') {
      return `Langkah ${i + 1}: LIST_DIR ${h.target}\n${h.listing}`;
    }
    if (h.action === 'edit') {
      return `Langkah ${i + 1}: EDIT ${h.target} — ${h.approved ? 'diterapkan' : 'DITOLAK user'}`;
    }
    if (!h.approved) {
      return `Langkah ${i + 1}: BASH "${h.command}" — DITOLAK user`;
    }
    if (h.action === 'remember') {
      return `Langkah ${i + 1}: REMEMBER ${h.key} = "${h.value}"`;
    }
    if (h.action === 'user_condition') {
      return `Langkah ${i + 1}: [USER CONDITION] "${h.condition}" — agent wajib mempertimbangkan ini`;
    }
    const stderrPart = h.result.stderr ? `, stderr: ${h.result.stderr.slice(0, 500)}` : '';
    return `Langkah ${i + 1}: BASH "${h.command}" — exit ${h.result.code}, stdout: ${h.result.stdout.slice(0, 300)}${stderrPart}`;
    }).join('\n');
    }

export async function planStep(askFn, { instruction, fileSnapshot, history, agentMd, recentMemory }) {
  const systemPrompt = agentMd
    ? `${SYSTEM_PROMPT}\n\n## Project Instructions (AGENT.md)\n${agentMd}`
    : SYSTEM_PROMPT;

  const memoryText = recentMemory && recentMemory.length > 0
  ? recentMemory.map(m => `- [${m.key}]: ${m.value}`).join('\n')
  : '(belum ada memory tersimpan)';

  const userPrompt = `Isi file saat ini (kalau relevan):
---
${fileSnapshot}
---

History langkah sebelumnya di task ini:
${buildHistoryText(history)}

Tentuin langkah berikutnya.`;

  const raw = await askFn(systemPrompt, userPrompt);

  const reasoningMatch = raw.match(/REASONING:\s*(.*)/);
  const actionMatch = raw.match(/ACTION:\s*(edit|bash|done|read|list_dir|remember)/);
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

  if (action === 'read') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    if (!targetMatch) throw new Error(`ACTION read tapi tidak ada TARGET.\n--- raw ---\n${raw}`);
    return { action, reasoning, target: targetMatch[1].trim() };
  }

  if (action === 'list_dir') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    return { action, reasoning, target: targetMatch ? targetMatch[1].trim() : '.' };
  }

  if (action === 'remember') {
    const keyMatch = raw.match(/KEY:\s*(.*)/);
    const valueMatch = raw.match(/VALUE:\s*(.*)/);
    if (!keyMatch || !valueMatch) throw new Error(`ACTION remember tapi KEY/VALUE tidak lengkap.\n--- raw ---\n${raw}`);
    return { action, reasoning, key: keyMatch[1].trim(), value: valueMatch[1].trim() };
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
