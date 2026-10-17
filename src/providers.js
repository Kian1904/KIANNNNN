// src/providers.js — Dynamic multi-provider cascade reading from settings.json

import { loadProviders } from './providers-registry.js';

// ── Adapter: OpenAI-compatible provider ──────────────────────────────────────
function makeOpenAICompatible({ name, baseUrl, apiKey, model }) {
  return async function ask(systemPrompt, userPrompt) {
    const completeUrl = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    // No-auth provider (apiKey kosong): JANGAN kirim header Authorization sama
    // sekali — endpoint anonim (mis. OVHcloud) kadang nolak request yang bawa
    // Bearer kosong/salah. Backward compatible: provider ber-key tetap dikirim.
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    const res = await fetch(completeUrl, {
      method: 'POST',
      headers,
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
    const content = data?.choices?.[0]?.message?.content;
    // Beberapa model (reasoning-first) balikin content kosong + naro hasil di
    // reasoning/reasoning_content. Kalau kosong, ambil itu biar gak dianggap
    // sukses kosong (jebakan empty-200 yang bikin cascade mandek).
    if (content == null || content === '') {
      const msg = data?.choices?.[0]?.message || {};
      const alt = msg.reasoning_content || msg.reasoning || '';
      if (alt) return alt;
    }
    return content;
  };
}

// ── Adapter: Gemini (beda endpoint shape) ────────────────────────────────────
async function askGeminiDynamic(baseUrl, apiKey, model, systemPrompt, userPrompt) {
  if (!apiKey) throw new Error('API key Gemini kosong di settings.json');

  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }]
    })
  });

  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ── Runtime model switch state ───────────────────────────────────────────────
let _primaryKey = null;
export function setModelPrimary(key) { _primaryKey = key; }
export function getModelPrimary() { return _primaryKey; }

export const fallbackState = { lastProvider: null };

// ── Build active provider list from settings.json ────────────────────────────
export function getDynamicProviders() {
  const providersData = loadProviders();
  return providersData
    .filter(p => p.active)
    .map(p => {
      const isGemini = p.name === 'gemini'
        || p.baseUrl.includes('google')
        || p.baseUrl.includes('generativelanguage');

      return {
        key: p.name,
        name: p.name.toUpperCase(),
        fn: isGemini
          ? (sys, usr) => askGeminiDynamic(p.baseUrl, p.apiKey, p.model, sys, usr)
          : makeOpenAICompatible({ name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model })
      };
    });
}

// For /model menu
export const PROVIDER_NAMES = loadProviders().map(p => ({
  key: p.name,
  label: `${p.name.toUpperCase()} (${p.name})`
}));

// ── Cascade race ─────────────────────────────────────────────────────────────
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

// ── Main entry with /model override ─────────────────────────────────────────
export async function askWithFallback(systemPrompt, userPrompt) {
  let order = getDynamicProviders();

  if (order.length === 0) {
    throw new Error('Tidak ada provider aktif di settings.json. Gunakan /auth untuk menambahkan.');
  }

  if (_primaryKey) {
    const idx = order.findIndex(p => p.key === _primaryKey);
    if (idx > 0) {
      const [chosen] = order.splice(idx, 1);
      order = [chosen, ...order];
    }
  }

  return raceProviders(order, systemPrompt, userPrompt);
}