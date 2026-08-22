// lib/intent.js — LLM classifier untuk routing input user

const INTENT_SYSTEM = `Kamu classifier intent. Baca input user dan jawab SATU KATA saja:
- casual   → salam, obrolan, pertanyaan umum, diskusi, "apa itu X"
- task     → instruksi teknis yang butuh eksekusi (install, buat, hapus, tulis, fix, run, baca file, list folder)
- hybrid   → gabungan: ada pertanyaan SEKALIGUS ada instruksi ("jelaskan lalu buat", "plan dulu baru eksekusi")

Jawab HANYA: casual / task / hybrid. Tanpa penjelasan, tanpa tanda baca.`;

export async function classifyIntent(input, askFn) {
  try {
    const raw = await askFn(INTENT_SYSTEM, `Input: "${input}"`);
    const result = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (['casual', 'task', 'hybrid'].includes(result)) return result;
    // Kalau model jawab sesuatu yang aneh, default ke task (lebih aman)
    return 'task';
  } catch {
    return 'task'; // fallback kalau classifier fail
  }
}