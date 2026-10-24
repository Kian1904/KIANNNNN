// src/routing.js — Auto-routing: task biasa vs squad (multi-agent).
//
// PRINSIP DESAIN: cuma route ke squad kalau ada BUKTI KUAT. Kalau ragu,
// jatuh ke single-agent. Alasan: squad manggil `plan()` (1 panggilan LLM)
// lalu N worker (masing-masing task = panggilan LLM lagi). Jadi salah-route
// ke squad itu mahal: lambat + makan kuota. Salah-route ke single-agent cuma
// berarti user harus ketik /squad manual.
//
// Karena itu murni HEURISTIK TEKS — sengaja TIDAK manggil LLM. Panggilan LLM
// buat nentuin "pake LLM lagi apa enggak" itu kontraproduktif: ongkosnya sama
// kayak langsung ngerjain, tapi tanpa kepastian.
//
// Written by K'

/** Penanda ada DUA pekerjaan atau lebih yang diurutkan. */
const SEQUENCE_MARKERS = [
  /\blalu\b/i,
  /\bterus\b/i,
  /\bsetelah\s+itu\b/i,
  /\bsetelahnya\b/i,
  /\bhabis\s+itu\b/i,
  /\bhabisnya\b/i,
  /\bkemudian\b/i,
  /\btrus\b/i,
  /\bkalo\s+udah\b/i,
  /\bkalau\s+udah\b/i,
  /\bpertama\b[\s\S]{3,80}\b(kedua|baru|lanjut)\b/i,
  /\bdulu\b[\s\S]{3,80}\bbaru\b/i,
  /\bthen\b/i,
  /\bafter\s+that\b/i,
  /\band\s+then\b/i,
];

/** Penanda task butuh LINTAS DISIPLIN (riset + koding, dst). */
const CROSS_DISCIPLINE_MARKERS = [
  /\briset\b[\s\S]{0,120}\b(bikin|buat|tulis|implementasi|koding|kode)\b/i,
  /\b(bikin|buat|tulis|implementasi|koding|kode)\b[\s\S]{0,120}\briset\b/i,
  /\bcari\s+tahu\b[\s\S]{0,120}\b(bikin|buat|tulis|implementasi)\b/i,
  /\banalisis\b[\s\S]{0,100}\b(bikin|buat|implementasi)\b/i,
  /\bresearch\b[\s\S]{0,120}\b(implement|build|write|code)\b/i,
  /\b(implement|build|write|code)\b[\s\S]{0,120}\bresearch\b/i,
  /\breview\b[\s\S]{0,80}\b(benerin|fix|perbaiki)\b/i,
];

/** Penanda review/verifikasi yang biasanya butuh agent kedua. */
const REVIEW_MARKERS = [
  /\breview\b/i,
  /\buji\s+(ulang|lagi)\b/i,
  /\bverifikasi\b/i,
  /\bcek\s+ulang\b/i,
  /\bperiksa\s+kembali\b/i,
];

/**
 * Penanda RISET MENDALAM — kata yang biasanya beneran butuh kerja bertahap
 * (kumpulin sumber, bandingin, simpulin). SENGAJA cuma kata yang berat,
 * bukan "analisis" generik — "analisis performa query" bisa dijawab satu agent.
 * Ini SELALU dipasangkan dengan shouldAsk: true (lihat routeTask langkah 3b).
 */
const RESEARCH_MARKERS = [
  /\briset\b/i,
  /\bresearch\b/i,
  /\bcari\s+tahu\b/i,
  /\bsurvei\b/i,
  /\bbenchmark\b/i,
  /\bbandingkan\b[\s\S]{0,60}\bdan\b/i,
  /\bkumpulin\s+(data|sumber|referensi)\b/i,
];

/** Penanda task besar — indikatif, tapi gak cukup sendirian. */
const VOLUME_MARKERS = [
  /\bproject\b/i,
  /\bproyek\b/i,
  /\bfitur\s+baru\b/i,
  /\brefactor(ing)?\b/i,
  /\bmigrasi\b/i,
  /\bmodul\s+baru\b/i,
  /\bfull[\s-]?stack\b/i,
];

/**
 * Penanda task SIMPEL — kalau ada ini, JANGAN route ke squad walaupun
 * ada marker urutan. Contoh: "baca file X terus ringkas" itu satu agent aja cukup.
 */
const SIMPLE_TASK_MARKERS = [
  /^\s*(baca|lihat|tampilkan|list|ls|cat|cek|apa isi)\b/i,
  /^\s*(jalankan|run|jalanin)\s+\S+\s*$/i,
  /^\s*(kirim|send|post)\b/i,
  /^\s*(ringkas|rangkum|summarize)\b/i,
];

/** Panjang minimum biar sebuah task dianggap "berat". */
const HEAVY_LENGTH = 160;

/**
 * Hitung sinyal yang ketemu di teks.
 * @param {string} text
 * @returns {{sequences:string[], cross:string[], reviews:string[], volumes:string[], simple:boolean, length:number}}
 */
export function collectSignals(text) {
  const s = String(text || '');
  const pick = (list) => list.filter(re => re.test(s)).map(re => re.source);
  return {
    sequences: pick(SEQUENCE_MARKERS),
    cross: pick(CROSS_DISCIPLINE_MARKERS),
    reviews: pick(REVIEW_MARKERS),
    research: pick(RESEARCH_MARKERS),
    volumes: pick(VOLUME_MARKERS),
    simple: SIMPLE_TASK_MARKERS.some(re => re.test(s)),
    length: s.length,
  };
}

/**
 * Putuskan mau route ke mana.
 *
 * @param {string} instruction
 * @returns {{
 *   route: 'squad'|'single',
 *   confidence: 'high'|'medium'|'low',
 *   shouldAsk: boolean,
 *   signals: object,
 *   reason: string
 * }}
 */
export function routeTask(instruction) {
  const signals = collectSignals(instruction);

  // 1. Task simpel yang jelas → jangan pernah ke squad, titik.
  //    Contoh: "baca src/ui.js terus ringkas" — urutannya cuma satu action.
  if (signals.simple && signals.sequences.length > 0
      && signals.cross.length === 0 && signals.reviews.length === 0) {
    return {
      route: 'single', confidence: 'high', shouldAsk: false, signals,
      reason: 'Task simpel (satu action) walau ada kata urutan.',
    };
  }

  // 2. Lintas disiplin + urutan → squad, yakin tinggi.
  if (signals.cross.length > 0 && signals.sequences.length > 0) {
    return {
      route: 'squad', confidence: 'high', shouldAsk: false, signals,
      reason: 'Lintas disiplin (mis. riset → koding) DAN ada urutan eksplisit.',
    };
  }

  // 3. Lintas disiplin sendirian → squad, tapi tanya dulu (bisa jadi cuma
  //    minta penjelasan konsep, bukan minta dikerjakan).
  if (signals.cross.length > 0) {
    return {
      route: 'squad', confidence: 'medium', shouldAsk: true, signals,
      reason: 'Kelihatannya lintas disiplin, tapi urutannya gak eksplisit.',
    };
  }

  // 3b. Kata riset mendalam sendirian → squad, tapi WAJIB konfirmasi.
  //     "riset" itu ambigu: bisa minta dikerjakan (butuh squad), bisa cuma
  //     minta penjelasan. Jadi jangan pernah jalan otomatis.
  if (signals.research.length > 0) {
    return {
      route: 'squad', confidence: 'medium', shouldAsk: true, signals,
      reason: 'Ada kata riset/benchmark — kemungkinan butuh kumpulin sumber bertahap.',
    };
  }

  // 4. Urutan + volume + panjang → squad yakin tinggi.
  if (signals.sequences.length > 0 && signals.volumes.length > 0 && signals.length >= HEAVY_LENGTH) {
    return {
      route: 'squad', confidence: 'high', shouldAsk: false, signals,
      reason: 'Task besar (project/fitur/refactor) dengan beberapa tahap.',
    };
  }

  // 5. Urutan + panjang banget + ada review → squad, tapi konfirmasi dulu.
  if (signals.sequences.length > 0 && signals.reviews.length > 0) {
    return {
      route: 'squad', confidence: 'medium', shouldAsk: true, signals,
      reason: 'Ada urutan dan minta review/verifikasi.',
    };
  }

  // 6. Banyak tahap (≥2 marker urutan) + panjang → squad, konfirmasi.
  if (signals.sequences.length >= 2 && signals.length >= HEAVY_LENGTH) {
    return {
      route: 'squad', confidence: 'medium', shouldAsk: true, signals,
      reason: 'Ada beberapa tahap berurutan di task yang cukup panjang.',
    };
  }

  // 7. Sisanya → single-agent. Ini mayoritas kasus, dan itu SENGAJA.
  return {
    route: 'single', confidence: 'high', shouldAsk: false, signals,
    reason: 'Gak ada sinyal kuat buat multi-agent.',
  };
}

/**
 * Format ringkas hasil routing buat ditampilin ke user.
 * @param {ReturnType<typeof routeTask>} verdict
 */
export function describeRouting(verdict) {
  return `${verdict.route.toUpperCase()} (${verdict.confidence}) — ${verdict.reason}`;
}
