// 4 dari 5 provider ini OpenAI-compatible (bentuk request/response sama),
// beda cuma base URL, API key, dan nama model. Gemini beda bentuk sendiri.

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

export const askGroq = makeOpenAICompatible({
  name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1',
  apiKeyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', defaultModel: 'qwen/qwen3.6-27b'
});

export const askOpenRouter = makeOpenAICompatible({
  name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free'
});

export const askNvidia = makeOpenAICompatible({
  name: 'Nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1',
  apiKeyEnv: 'NVIDIA_API_KEY', modelEnv: 'NVIDIA_MODEL', defaultModel: 'poolside/laguna-xs-2.1'
});

export const askMistral = makeOpenAICompatible({
  name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1',
  apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-small-latest'
});

// Gemini beda bentuk: system_instruction terpisah, contents/parts bukan messages
export async function askGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY belum di-set di .env');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
    })
  });

  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

const PROVIDER_ORDER = [
  { name: 'Groq', fn: askGroq },
  { name: 'Gemini', fn: askGemini },
  { name: 'OpenRouter', fn: askOpenRouter },
  { name: 'Nvidia', fn: askNvidia },
  { name: 'Mistral', fn: askMistral }
];

export const fallbackState = { lastProvider: null };

// Diekspos terpisah dari askWithFallback biar bisa dites pakai daftar provider palsu
export async function raceProviders(providerList, systemPrompt, userPrompt) {
  const errors = [];
  for (const p of providerList) {
    try {
      const result = await p.fn(systemPrompt, userPrompt);
      fallbackState.lastProvider = p.name;
      return result;
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      console.log(`[FALLBACK] ${p.name} gagal — coba provider berikutnya...`);
    }
  }
  fallbackState.lastProvider = null;
  throw new Error(`Semua provider gagal:\n${errors.join('\n')}`);
}

export async function askWithFallback(systemPrompt, userPrompt) {
  return raceProviders(PROVIDER_ORDER, systemPrompt, userPrompt);
}

