// M56: regresi 3 bug yang ketemu saat test pemakaian nyata (2026-11-14).
// Test otomatis lama GAK nangkep ini karena pakai .settings.json mock + task pendek.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

// ── BUG 1: systemPromptOverride MENGGANTI system prompt (bukan menambah) ─────
// Akibat: SYSTEM_PROMPT (daftar action valid) hilang → model ngarang
// "ACTION: READ_FILE" → parser gagal → agent mati total kalau ada contract.
console.log('\n[BUG 1] systemPromptOverride harus DIGABUNG, bukan mengganti');
{
  const { planStep } = await import('../src/plan.js');
  const { SYSTEM_PROMPT } = await import('../src/prompts/system.js');

  let capturedSystem = null;
  const spyAsk = async (sys) => {
    capturedSystem = sys;
    return 'REASONING: tes\nACTION: done\nSUMMARY: ok';
  };

  await planStep(spyAsk, {
    instruction: 'tes',
    fileSnapshot: '',
    history: [],
    agentMd: null,
    recentMemory: [],
    availableTools: [],
    webSearchCount: 0,
    systemPromptOverride: '## KONTRAK TASK\nGOAL: tes',
  });

  check('system prompt berisi SYSTEM_PROMPT asli', capturedSystem.includes(SYSTEM_PROMPT.slice(0, 100)));
  check('system prompt berisi override', capturedSystem.includes('KONTRAK TASK'));
  check('SYSTEM_PROMPT muncul SEBELUM override', capturedSystem.indexOf(SYSTEM_PROMPT.slice(0, 50)) < capturedSystem.indexOf('KONTRAK TASK'));
  check('daftar action valid tetap ada', /ACTION:\s*\(satu dari|read, list_dir, edit/.test(capturedSystem) || capturedSystem.includes('list_dir'));
}

// ── BUG 2: native tool-calling harus dimatikan (tool_choice: 'none') ─────────
// Akibat: model baru (gpt-oss, qwen3) balas <tool_call>/JSON, bukan "ACTION:".
console.log('\n[BUG 2] request harus kirim tool_choice: none');
{
  const src = fs.readFileSync(new URL('../src/providers.js', import.meta.url), 'utf8');
  check('providers.js kirim tool_choice', src.includes("tool_choice: 'none'"));
  check('ada komentar penjelasan', /tool-calling|tool_choice/i.test(src));
}

// ── BUG 3: PROVIDER_NAMES jangan dievaluasi di top-level ─────────────────────
// Akibat: ESM hoisting → loadProviders() jalan sebelum dotenv → key kosong.
console.log('\n[BUG 3] PROVIDER_NAMES harus lazy (bukan loadProviders() di top-level)');
{
  const src = fs.readFileSync(new URL('../src/providers.js', import.meta.url), 'utf8');
  check('tidak ada `export const PROVIDER_NAMES = loadProviders()`', !/export const PROVIDER_NAMES = loadProviders\(\)/.test(src));
  check('ada getProviderNames()', src.includes('export function getProviderNames'));
  check('PROVIDER_NAMES pakai Proxy (lazy)', src.includes('new Proxy'));

  // Fungsional: PROVIDER_NAMES harus bisa diakses tanpa error
  const { PROVIDER_NAMES, getProviderNames } = await import('../src/providers.js');
  check('PROVIDER_NAMES.length bisa diakses', typeof PROVIDER_NAMES.length === 'number');
  check('getProviderNames() balikin array', Array.isArray(getProviderNames()));
  check('PROVIDER_NAMES[0] punya key+label', PROVIDER_NAMES[0]?.key && PROVIDER_NAMES[0]?.label);
}

// ── Integrasi: planStep dengan override tetap bisa parse ACTION ──────────────
console.log('\n[INTEGRASI] planStep dengan override tetap parse ACTION valid');
{
  const { planStep } = await import('../src/plan.js');
  const spyAsk = async () => 'REASONING: baca file\nACTION: read\nTARGET: x.js';
  const step = await planStep(spyAsk, {
    instruction: 'tes', fileSnapshot: '', history: [], agentMd: null,
    recentMemory: [], availableTools: [], webSearchCount: 0,
    systemPromptOverride: '## KONTRAK TASK\nGOAL: tes',
  });
  check('step.action = read', step.action === 'read');
  check('step.target = x.js', step.target === 'x.js');
}

console.log(`\n=== HASIL REGRESI M56: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
