// M59 RED: interactive clarification — deteksi ambigu, ajukan pertanyaan.
import {
  detectAmbiguity, generateQuestions, shouldClarify,
  incorporateAnswers, AMBIGUITY_PATTERNS,
} from '../src/clarification.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] detectAmbiguity ─────────────────────────────────────────────────────
{
  const r = detectAmbiguity('Bikin file hello.txt berisi "Hello World"');
  check('ambiguity: instruksi jelas -> tidak ambigu', r.ambiguous === false);
}
{
  const r = detectAmbiguity('Bikin API login');
  check('ambiguity: "API login" -> ambigu', r.ambiguous === true);
  check('ambiguity: ada issues', r.issues.length > 0);
  check('ambiguity: issue menyebut auth', r.issues.some(i => /auth|login|metode/i.test(i.name + i.question)));
}
{
  const r = detectAmbiguity('Bikin website');
  check('ambiguity: "website" -> ambigu', r.ambiguous === true);
}
{
  const r = detectAmbiguity('Rapihin kode');
  check('ambiguity: "rapihin kode" -> ambigu (file apa?)', r.ambiguous === true);
}
{
  const r = detectAmbiguity('Tolong perbaiki file src/auth.js yang error di baris 42');
  check('ambiguity: spesifik -> tidak ambigu', r.ambiguous === false);
}

// ── [2] generateQuestions ───────────────────────────────────────────────────
{
  const r = detectAmbiguity('Bikin API login');
  const questions = generateQuestions(r);
  check('questions: array of questions', Array.isArray(questions) && questions.length > 0);
  check('questions: setiap question punya text', questions.every(q => q.text && q.text.length > 0));
  check('questions: setiap question punya options atau freeform', questions.every(q => q.options || q.freeform));
}
{
  const r = detectAmbiguity('Bikin website');
  const questions = generateQuestions(r);
  check('questions: website -> tanya jenis', questions.some(q => /jenis|type|framework/i.test(q.text)));
}
{
  const r = detectAmbiguity('File hello.txt berisi Hello World');
  const questions = generateQuestions(r);
  check('questions: instruksi jelas -> kosong', questions.length === 0);
}

// ── [3] shouldClarify ───────────────────────────────────────────────────────
{
  check('clarify: ambigu -> ya', shouldClarify('Bikin API login') === true);
  check('clarify: jelas -> tidak', shouldClarify('Bikin file hello.txt berisi Hello World') === false);
  check('clarify: kosong -> tidak', shouldClarify('') === false);
  check('clarify: null -> tidak', shouldClarify(null) === false);
}

// ── [4] incorporateAnswers ──────────────────────────────────────────────────
{
  const questions = generateQuestions(detectAmbiguity('Bikin API login'));
  const answers = questions.map(q => ({ questionId: q.id, answer: q.options ? q.options[0] : 'custom' }));
  const enhanced = incorporateAnswers('Bikin API login', answers);
  check('answers: instruksi diperkaya', enhanced.length > 'Bikin API login'.length);
  check('answers: memuat jawaban', enhanced.includes(answers[0].answer));
}
{
  const enhanced = incorporateAnswers('Bikin file hello.txt', []);
  check('answers: tanpa jawaban -> instruksi asli', enhanced === 'Bikin file hello.txt');
}

// ── [5] AMBIGUITY_PATTERNS ──────────────────────────────────────────────────
{
  check('patterns: array non-empty', Array.isArray(AMBIGUITY_PATTERNS) && AMBIGUITY_PATTERNS.length > 0);
  check('patterns: setiap entry punya name + regex', AMBIGUITY_PATTERNS.every(p => p.name && p.pattern instanceof RegExp));
}

// ── [6] Robustness ──────────────────────────────────────────────────────────
{
  check('detect: null tidak crash', typeof detectAmbiguity(null) === 'object');
  check('generate: null tidak crash', Array.isArray(generateQuestions(null)));
  check('incorporate: null answers tidak crash', typeof incorporateAnswers('x', null) === 'string');
}

console.log(`\n=== HASIL CLARIFICATION: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
