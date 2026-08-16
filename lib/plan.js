const SYSTEM_PROMPT = `Kamu agent yang bantu edit file. User kasih isi file saat ini + instruksi.
Balas HANYA dengan 1 blok JSON (tanpa markdown fence, tanpa teks lain) persis format ini:
{"reasoning": "alasan singkat", "new_content": "isi lengkap file setelah diedit"}
"new_content" harus isi LENGKAP file (bukan potongan/diff), siap ditulis langsung.`;

export async function planEdit(askFn, currentContent, instruction) {
  const userPrompt = `Isi file saat ini:\n---\n${currentContent}\n---\n\nInstruksi: ${instruction}`;
  const raw = await askFn(SYSTEM_PROMPT, userPrompt);

  let parsed;
  try {
    // jaga-jaga kalau model tetap bungkus pakai ```json fence walau udah dilarang
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Respons LLM bukan JSON valid: ${e.message}\n--- raw ---\n${raw}`);
  }

  if (typeof parsed.new_content !== 'string') {
    throw new Error(`Respons LLM tidak punya field "new_content" yang valid.\n--- raw ---\n${raw}`);
  }

  return parsed;
}
