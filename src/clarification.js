// M59: interactive clarification — deteksi instruksi ambigu, ajukan pertanyaan.
//
// Kenapa ini ada: agent sering langsung eksekusi berdasarkan asumsi saat
// instruksi ambigu. "Bikin API login" — login pakai apa? JWT? Session? OAuth?
// M59 mendeteksi ambiguitas dan mengajukan pertanyaan sebelum eksekusi.
//
// Prinsip: lebih baik nanya dulu daripada salah kerja.
//
// Written by K'

/**
 * Pola ambiguitas umum. Setiap entry: name, pattern (regex), question template.
 */
export const AMBIGUITY_PATTERNS = [
  {
    name: 'auth_method',
    pattern: /\b(api|endpoint|service|layanan)\s+(login|auth|authentication|register|signup)\b/i,
    question: 'Metode autentikasi apa yang dipakai?',
    options: ['JWT', 'Session-based', 'OAuth2', 'API Key'],
  },
  {
    name: 'website_type',
    pattern: /\b(bikin|buat|buatkan)\s+(website|web|situs|landing\s*page)\b/i,
    question: 'Jenis website apa yang dibuat?',
    options: ['Static HTML', 'React/SPA', 'Full-stack (frontend + backend)', 'Landing page sederhana'],
  },
  {
    name: 'vague_refactor',
    pattern: /\b(rapihin|refactor|bersihin|perbaiki)\s+(kode|code|program|aplikasi|semua)\b/i,
    question: 'File/bagian mana yang mau dirapikan?',
    options: [],
    freeform: true,
  },
  {
    name: 'vague_fix',
    pattern: /\b(fix|perbaiki|benerin)\s+(bug|error|masalah|semuanya)\b/i,
    question: 'Error/bug apa yang terjadi? Ada pesan error?',
    options: [],
    freeform: true,
  },
  {
    name: 'database_choice',
    pattern: /\b(database|db|basis\s*data|penyimpanan)\b/i,
    question: 'Database apa yang dipakai?',
    options: ['SQLite', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis'],
  },
  {
    name: 'deployment_target',
    pattern: /\b(deploy|deploykan|hosting|hostingkan|publish)\b/i,
    question: 'Mau deploy ke mana?',
    options: ['VPS', 'Vercel', 'Netlify', 'Docker', 'Belum tahu'],
  },
  {
    name: 'framework_choice',
    pattern: /\b(framework|library|pustaka)\b/i,
    question: 'Framework/library apa yang dipakai?',
    options: [],
    freeform: true,
  },
];

let _qCounter = 0;

/**
 * Deteksi apakah instruksi mengandung ambiguitas.
 * @param {string} instruction
 * @returns {{ambiguous: boolean, issues: Array<{name:string, question:string, options:string[], freeform:boolean}>}}
 */
export function detectAmbiguity(instruction) {
  const text = String(instruction ?? '');
  if (!text.trim()) return { ambiguous: false, issues: [] };

  const issues = [];
  for (const { name, pattern, question, options, freeform } of AMBIGUITY_PATTERNS) {
    if (pattern.test(text)) {
      issues.push({ name, question, options: options || [], freeform: !!freeform });
    }
  }

  // Deteksi tambahan: instruksi sangat pendek + tidak spesifik.
  const words = text.trim().split(/\s+/);
  if (words.length <= 3 && !/file|folder|\.js|\.py|\.txt|\.json|\.md/i.test(text)) {
    issues.push({
      name: 'too_vague',
      question: 'Bisa jelaskan lebih detail apa yang mau dikerjakan?',
      options: [],
      freeform: true,
    });
  }

  return { ambiguous: issues.length > 0, issues };
}

/**
 * Generate pertanyaan klarifikasi dari hasil deteksi ambiguitas.
 * @param {{issues: Array}} detection
 * @returns {Array<{id:string, text:string, options:string[], freeform:boolean}>}
 */
export function generateQuestions(detection) {
  const issues = detection?.issues || [];
  return issues.map(issue => ({
    id: `q-${++_qCounter}`,
    text: issue.question,
    options: issue.options || [],
    freeform: !!issue.freeform,
  }));
}

/**
 * Apakah instruksi perlu klarifikasi?
 * @param {string} instruction
 * @returns {boolean}
 */
export function shouldClarify(instruction) {
  if (!instruction || !String(instruction).trim()) return false;
  return detectAmbiguity(instruction).ambiguous;
}

/**
 * Gabungkan jawaban user ke instruksi asli.
 * @param {string} instruction - instruksi asli
 * @param {Array<{questionId:string, answer:string}>} answers
 * @returns {string} instruksi yang sudah diperkaya
 */
export function incorporateAnswers(instruction, answers = []) {
  const base = String(instruction ?? '');
  if (!Array.isArray(answers) || answers.length === 0) return base;

  const extras = answers
    .filter(a => a && a.answer)
    .map(a => `- ${a.answer}`)
    .join('\n');

  if (!extras) return base;
  return `${base}\n\nDetail dari user:\n${extras}`;
}
