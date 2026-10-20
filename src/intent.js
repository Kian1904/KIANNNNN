// src/intent.js — Classifier intent: casual / task / hybrid.
//
// PERUBAHAN (2026-10-20): dulu SETIAP input user manggil LLM cuma buat nentuin
// intent. Itu satu panggilan penuh SEBELUM kerjaan dimulai — buat input kayak
// "halo" atau "fix typo". Sekarang: heuristik dulu, LLM cuma dipakai kalau
// heuristik ragu. Ini ngilangin mayoritas panggilan classifier.
//
// Sumber sinyal diambil dari routing.js (padanan regex-nya) supaya konsisten:
// kalau routing bilang "task kompleks", intent juga harus bilang task.
//
// Written by K-sRouter

/** Perintah/permintaan eksekusi yang jelas — gak perlu mikir. */
const TASK_VERBS = [
  /\b(buat|bikin|buatkan|tulis|tuliskan|generate|create|write)\b/i,
  /\b(fix|perbaiki|benerin|betulin|repair)\b/i,
  /\b(install|pasang|uninstall|copot)\b/i,
  /\b(hapus|delete|remove|rm)\b/i,
  /\b(rename|pindah|move|ganti nama)\b/i,
  /\b(run|jalankan|jalanin|eksekusi|execute)\b/i,
  /\b(refactor|refaktor|bersihin kode)\b/i,
  /\b(test|tes|uji)\b/i,
  /\b(deploy|build|compile|push|commit)\b/i,
  /\b(baca|read|lihat|tampilkan|buka|cat|show)\b/i,
  /\b(list|ls|daftar)\b/i,
  /\b(edit|ubah|modif|update|tambah|tambahkan|ganti)\b/i,
  /\b(cari|search|find|grep|scan)\b/i,
  /\b(download|unduh|upload|unggah|kirim)\b/i,
];

/** Kata yang nunjukin butuh info TERKINI — wajib task (butuh web). */
const REALTIME_MARKERS = [
  /\b(terbaru|terkini|saat ini|hari ini)\b/i,
  /\b(rilis|release|versi terbaru|update terbaru)\b/i,
  /\b(harga|kurs|nilai tukar)\b/i,
  /\b(berita|news|kabar)\b/i,
  /\b(siapa yang menjabat|presiden|menteri|ceo)\b/i,
  /\b(latest|current|now|today)\b/i,
];

/**
 * Sinyal waktu yang SENDIRIAN gak cukup buat bilang "butuh info terkini".
 * "tadi", "sekarang", "saat ini" sering muncul di cerita/obrolan biasa
 * ("aku tadi mimpi aneh") — bukan permintaan data real-time.
 * Baru dianggap realtime kalau NEMPEL sama kata tanya/aksi mencari.
 */
const SOFT_TIME_MARKERS = [
  /\b(tadi|sekarang|barusan|baru saja)\b/i,
];

/** Konteks yang bikin sinyal waktu jadi beneran minta data. */
const INFO_SEEK_MARKERS = [
  /\b(harga|kurs|nilai tukar|skor|hasil|jadwal|cuaca|suhu)\b/i,
  /\b(berapa|kapan|di mana|dimana|siapa)\b/i,
  /\b(cek|cek-in|caritau|cari tau|cari|cek update|pantau|monitor)\b/i,
];

/** Penanda gabungan: tanya + suruh. */
const COMBINED_MARKERS = [
  /\b(lalu|terus|setelah itu|kemudian|habis itu|trus|then|after that)\b/i,
];

function anyMatch(list, text) {
  return list.some(re => re.test(text));
}

/** Sapaan / obrolan murni. */
const CASUAL_PATTERNS = [
  /^\s*(halo|hai|hi|hello|hey|oi|oy|pagi|siang|sore|malam|assalam\w*)\b/i,
  /^\s*(makasih|thanks|thank you|thx|sip|oke|ok|mantap|nice|keren|good job)\b/i,
  /^\s*(kaccan|kian|bro|bang|gan)\b/i,
  /^\s*(apa kabar|gimana kabar|kamu siapa|siapa kamu|kamu bisa apa)\b/i,
  /^\s*(kok|kenapa|mengapa|why)\b/i,
];

/**
 * Pertanyaan konsep — jawabannya STABIL, gak berubah karena waktu.
 * Ini casual walau bentuknya tanya, karena gak butuh tool apa pun.
 */
const CONCEPT_QUESTIONS = [
  /^\s*(apa itu|apakah|apa yang dimaksud|apa bedanya|apa perbedaan)\b/i,
  /^\s*(jelasin|jelaskan|explain|terangkan|kasih tau)\b/i,
  /^\s*(kenapa|mengapa|why)\s+(kok|bisa|harus|itu|ini)\b/i,
  /^\s*(what is|what are|how does|how do)\b/i,
  /^\s*(contoh|example)\b/i,
];


/**
 * Heuristik intent. Return { intent, confident }.
 * Kalau confident=false, pemanggil boleh jatuh ke LLM (atau langsung pakai
 * nilai `intent` kalau mau hemat — default pemanggil kami pakai nilainya).
 *
 * @param {string} input
 * @returns {{ intent: 'casual'|'task'|'hybrid', confident: boolean, reason: string }}
 */
export function classifyIntentHeuristic(input) {
  const text = String(input || '').trim();
  if (!text) return { intent: 'casual', confident: true, reason: 'input kosong' };

  const hasRealtime = anyMatch(REALTIME_MARKERS, text);
  const hasTaskVerb = anyMatch(TASK_VERBS, text);
  const hasConceptQ = anyMatch(CONCEPT_QUESTIONS, text);
  const hasCombined = anyMatch(COMBINED_MARKERS, text);
  const looksCasual = anyMatch(CASUAL_PATTERNS, text);

  // 1a. Info terkini eksplisit ("harga", "berita", "versi terbaru") → WAJIB task.
  //     Ini aturan keras, gak perlu mikir.
  if (hasRealtime) {
    return { intent: 'task', confident: true, reason: 'butuh info terkini' };
  }

  // 1b. Sinyal waktu lemah ("sekarang", "tadi") HANYA jadi task kalau ada
  //     konteks minta data. Tanpa itu, "aku tadi mimpi aneh" tetap obrolan.
  if (anyMatch(SOFT_TIME_MARKERS, text) && anyMatch(INFO_SEEK_MARKERS, text)) {
    return { intent: 'task', confident: true, reason: 'minta data terkini' };
  }

  // 2. Cek HYBRID lebih dulu: tanya + suruh dalam satu kalimat.
  //    Urutannya penting — kalau TASK_VERBS dicek duluan, "tolong jelasin
  //    kenapa error lalu perbaiki" keburu dicap task dan sinyal tanya-nya hilang.
  if (hasConceptQ && hasTaskVerb) {
    return { intent: 'hybrid', confident: true, reason: 'tanya konsep + ada perintah' };
  }

  // 2b. Pola hybrid lain: perintah + penanda gabungan + kata tanya.
  //     ("tolong jelasin kenapa ... lalu perbaiki" — 'jelasin' bukan kata
  //     konsep, tapi 'kenapa' + 'lalu' + 'perbaiki' udah cukup jelas.)
  if (hasTaskVerb && hasCombined && /[?]|\b(kenapa|mengapa|apa|bagaimana|why|how)\b/i.test(text)) {
    return { intent: 'hybrid', confident: true, reason: 'perintah + kalimat tanya' };
  }

  // 3. Pertanyaan konsep murni, tanpa perintah → casual.
  if (hasConceptQ && !hasTaskVerb) {
    return { intent: 'casual', confident: true, reason: 'pertanyaan konsep stabil' };
  }

  // 4. Ada perintah eksekusi → task (kecuali sapaan pendek).
  if (hasTaskVerb) {
    // "halo, bisa baca file X?" — sapaan + perintah = tetap task.
    if (text.length < 12 && looksCasual && !hasCombined) {
      return { intent: 'casual', confident: true, reason: 'sapaan pendek' };
    }
    return { intent: 'task', confident: true, reason: 'ada perintah eksekusi' };
  }

  // 5. Sapaan/obrolan pendek → casual.
  if (looksCasual) {
    return { intent: 'casual', confident: true, reason: 'sapaan/obrolan' };
  }

  // 6. Kalimat pendek tanpa verb task → cenderung casual.
  if (text.length < 30) {
    return { intent: 'casual', confident: true, reason: 'kalimat pendek tanpa perintah' };
  }

  // 7. Panjang tapi gak ketemu sinyal apa pun. Dulu di sini gue balikin 'task'
  //    dengan confident:false — tapi fallback 'task' itu salah arah: nge-route
  //    obrolan ke agent otonom itu MAHAL (banyak LLM call + eksekusi tool),
  //    sedangkan salah tebak 'casual' cuma bikin user ngetik ulang.
  //    Jadi ragu → casual. Konsisten sama prinsip routing: ragu = jalur murah.
  //    Sinyal kuat di atas tetep confident, jadi ini gak ngerusak task beneran.
  return { intent: 'casual', confident: false, reason: 'panjang tanpa sinyal jelas' };
}

const INTENT_SYSTEM = `Kamu classifier intent. Baca input user dan jawab SATU KATA saja:
- casual   → salam, obrolan, opini, pertanyaan konsep umum yang jawabannya stabil/gak berubah ("apa itu X", "jelasin cara kerja Y")
- task     → instruksi teknis yang butuh eksekusi (install, buat, hapus, tulis, fix, run, baca file, list folder), ATAU pertanyaan yang butuh info TERKINI/real-time/terbaru (rilis terbaru, harga sekarang, versi terbaru, "cari tau", "cek update", siapa yang menjabat sekarang, berita/event yang mungkin berubah setelah training cutoff)
- hybrid   → gabungan: ada pertanyaan SEKALIGUS ada instruksi ("jelaskan lalu buat", "plan dulu baru eksekusi")

Kata kunci yang WAJIB masuk task (bukan casual) meski bentuknya kayak pertanyaan: "terbaru", "terkini", "sekarang", "saat ini", "rilis", "cari", "cek", "update".

Jawab HANYA: casual / task / hybrid. Tanpa penjelasan, tanpa tanda baca.`;

/**
 * Klasifikasi intent.
 *
 * Alur: heuristik dulu (gratis). LLM cuma dipanggil kalau heuristik ragu DAN
 * pemanggil ngasih askFn. Kalau ragu tapi gak ada askFn, pakai tebakan
 * heuristik — lebih baik daripada nge-block.
 *
 * Set `K_SROUTER_INTENT_LLM=1` buat maksa selalu pakai LLM (buat debugging).
 *
 * @param {string} input
 * @param {(system: string, user: string) => Promise<string>} [askFn]
 * @returns {Promise<'casual'|'task'|'hybrid'>}
 */
export async function classifyIntent(input, askFn) {
  const h = classifyIntentHeuristic(input);

  const forceLlm = process.env.K_SROUTER_INTENT_LLM === '1';
  const wantLlm = forceLlm || !h.confident;

  if (!wantLlm || typeof askFn !== 'function') {
    return h.intent;
  }

  try {
    const raw = await askFn(INTENT_SYSTEM, `Input: "${input}"`);
    const result = String(raw).trim().toLowerCase().replace(/[^a-z]/g, '');
    if (['casual', 'task', 'hybrid'].includes(result)) return result;
    return h.intent; // jawaban model aneh → pakai heuristik
  } catch {
    return h.intent; // LLM gagal → pakai heuristik, jangan block user
  }
}
