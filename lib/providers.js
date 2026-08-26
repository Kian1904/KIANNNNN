// lib/providers.js — multi-provider cascade dengan /model switch support

function makeOpenAICompatible({ name, baseUrl, apiKeyEnv, modelEnv, defaultModel }) {
  return async function ask(systemPrompt, userPrompt) {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) throw new Error(`${apiKeyEnv} belum di-set di .env`);
    const model = process.env[modelEnv] || defaultModel;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2
      })
    });

    if (!res.ok) throw new Error(`${name} API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  };
}

// ── Model switch state ────────────────────────────────────────────────────────
let _primaryKey = null;
export function setModelPrimary(key) { _primaryKey = key; }
export function getModelPrimary() { return _primaryKey; }

// ── Provider functions ────────────────────────────────────────────────────────
export const askXKiroCoder = makeOpenAICompatible({
  name: 'xKiroCoder',
  baseUrl: 'https://api.xkiro.com/v1',
  apiKeyEnv: 'XKIRO_API_KEY',
  modelEnv: 'XKIRO_CODER_MODEL',
  defaultModel: 'qwen/qwen3-coder-plus:free'
});

export const askXKiro = makeOpenAICompatible({
  name: 'xKiro',
  baseUrl: 'https://api.xkiro.com/v1',
  apiKeyEnv: 'XKIRO_API_KEY',
  modelEnv: 'XKIRO_MODEL',
  defaultModel: 'deepseek/deepseek-v4-pro'
});

export const askOpenRouter = makeOpenAICompatible({
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  modelEnv: 'OPENROUTER_MODEL',
  defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free'
});

export const askNvidia = makeOpenAICompatible({
  name: 'Nvidia',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  apiKeyEnv: 'NVIDIA_API_KEY',
  modelEnv: 'NVIDIA_MODEL',
  defaultModel: 'poolside/laguna-xs-2.1'
});

export const askMistral = makeOpenAICompatible({
  name: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  apiKeyEnv: 'MISTRAL_API_KEY',
  modelEnv: 'MISTRAL_MODEL',
  defaultModel: 'mistral-small-latest'
});

export const askGroq = makeOpenAICompatible({
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKeyEnv: 'GROQ_API_KEY',
  modelEnv: 'GROQ_MODEL',
  defaultModel: 'qwen/qwen3.8-27b'
});

// Gemini: API shape beda, adapter terpisah
export async function askGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY belum di-set di .env');
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
      })
    }
  );

  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ── Cascade order (sesuai SPEC) ───────────────────────────────────────────────
const PROVIDER_ORDER = [
  { key: 'xkiro-coder',  name: 'xKiroCoder',   fn: askXKiroCoder },
  { key: 'gemini',       name: 'Gemini',        fn: askGemini },
  { key: 'xkiro',        name: 'xKiro',         fn: askXKiro },
  { key: 'openrouter',   name: 'OpenRouter',    fn: askOpenRouter },
  { key: 'nvidia',       name: 'Nvidia',        fn: askNvidia },
  { key: 'mistral',      name: 'Mistral',       fn: askMistral },
  { key: 'groq',         name: 'Groq',          fn: askGroq },
];

// Untuk /model list di index.js
export const PROVIDER_NAMES = PROVIDER_ORDER.map(p => ({
  key: p.key,
  label: `${p.name} (${p.key})`
}));

// ── Shared state ──────────────────────────────────────────────────────────────
export const fallbackState = { lastProvider: null };

// ── Core race function (bisa ditest dengan provider list palsu) ───────────────
export async function raceProviders(providerList, systemPrompt, userPrompt) {
  const errors = [];
  for (const p of providerList) {
    try {
      const result = await p.fn(systemPrompt, userPrompt);
      fallbackState.lastProvider = p.name;
      return result;
    } catch (err) {
      errors.push(`${p.name}: ${err.message.slice(0, 150)}`);
      console.log(`[FALLBACK] ${p.name} gagal (${err.message.slice(0, 200)}) — coba provider berikutnya...`);
    }
  }
  fallbackState.lastProvider = null;
  throw new Error(`Semua provider gagal:\n${errors.join('\n')}`);
}

// ── Main export: cascade dengan /model override ───────────────────────────────
export async function askWithFallback(systemPrompt, userPrompt) {
  let order = [...PROVIDER_ORDER];

  if (_primaryKey) {
    const idx = order.findIndex(p => p.key === _primaryKey);
    if (idx > 0) {
      // Angkat provider pilihan ke posisi pertama, sisanya tetap urutan asli
      const [chosen] = order.splice(idx, 1);
      order = [chosen, ...order];
    }
  }

  return raceProviders(order, systemPrompt, userPrompt);
}
