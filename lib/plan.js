const SYSTEM_PROMPT = `Kamu agent yang bantu edit file. User kasih isi file saat ini + instruksi.
Balas PERSIS format ini, tanpa markdown fence, tanpa teks lain di luar format:

REASONING: <alasan singkat satu baris>
===NEW_CONTENT_START===
<isi LENGKAP file setelah diedit, siap ditulis langsung>
===NEW_CONTENT_END===`;

export async function planEdit(askFn, currentContent, instruction) {
  const userPrompt = `Isi file saat ini:\n---\n${currentContent}\n---\n\nInstruksi: ${instruction}`;
  const raw = await askFn(SYSTEM_PROMPT, userPrompt);

  const reasoningMatch = raw.match(/REASONING:\s*(.*)/);
  const startIdx = raw.indexOf('===NEW_CONTENT_START===');
  const endIdx = raw.indexOf('===NEW_CONTENT_END===');

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`Respons LLM tidak sesuai format delimiter.\n--- raw ---\n${raw}`);
  }

  const newContent = raw
    .slice(startIdx + '===NEW_CONTENT_START==='.length, endIdx)
    .replace(/^\n/, '')
    .replace(/\n$/, '');

  return {
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : '(tidak ada alasan)',
    new_content: newContent
  };
}

