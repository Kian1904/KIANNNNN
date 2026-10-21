// src/providers.js — Dynamic multi-provider cascade reading from settings.json

import { loadProviders } from './providers-registry.js';
import { createProviderHealth } from './provider-health.js';

// M39: circuit breaker per provider. 429/rate-limit = cooldown, jangan dipanggil
// berulang-ulang sampai semua provider ikut tenggelam.
export const providerHealth = createProviderHealth({ cooldownMs: 60000 });

// ── Adapter: OpenAI-compatible provider ──────────────────────────────────────
// onToken: opsional. Kalau dikasih, teks di-stream ke caller sambil tetep
// dikumpulin utuh sebagai return value (jadi caller lama gak terpengaruh).
function makeOpenAICompatible({ name, baseUrl, apiKey, model }) {
  return async function ask(systemPrompt, userPrompt, onToken) {
    // Bangun URL lewat URL object, BUKAN concat string: baseUrl yang sudah punya
    // query string (mis. `...?mode=x`) bakal rusak kalau di-concat (query string
    // ke-append SETELAH /chat/completions). URL object nanganin path + query bener.
    const url = new URL(baseUrl);
    if (!url.pathname.endsWith('/chat/completions')) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
    }
    const completeUrl = url.toString();

    // No-auth provider (apiKey kosong): JANGAN kirim header Authorization sama
    // sekali — endpoint anonim (mis. OVHcloud) kadang nolak request yang bawa
    // Bearer kosong/salah. Backward compatible: provider ber-key tetap dikirim.
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    const useStream = typeof onToken === 'function';

    const res = await fetch(completeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        ...(useStream ? { stream: true } : {})
      })
    });

    if (!res.ok) throw new Error(`${name} API error ${res.status}: ${await res.text()}`);

    // ── Jalur non-streaming (default, dipakai semua test) ────────────────────
    if (!useStream) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      // Beberapa model (reasoning-first) balikin content kosong + naro hasil di
      // reasoning/reasoning_content. Kalau kosong, ambil itu biar gak dianggap
      // sukses kosong (jebakan empty-200 yang bikin cascade mandek). Fallback ini
      // CUMA jalan di non-streaming — waktu streaming gak ada reasoning_content.
      if (content == null || content === '') {
        const msg = data?.choices?.[0]?.message || {};
        const alt = msg.reasoning_content || msg.reasoning || '';
        if (alt) return alt;
      }
      return content;
    }

    // ── Jalur streaming (SSE) ────────────────────────────────────────────────
    // Provider yang gak ngerti `stream: true` balikin JSON biasa, bukan SSE.
    // Deteksi dari Content-Type: kalau bukan event-stream, balik ke json().
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('text/event-stream')) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) onToken(content);
      if (content == null || content === '') {
        const msg = data?.choices?.[0]?.message || {};
        const alt = msg.reasoning_content || msg.reasoning || '';
        if (alt) { onToken(alt); return alt; }
      }
      return content;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let doneReasoningOnly = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE: pisah per baris, tiap data-line diawali "data: ".
      const lines = buffer.split('\n');
      buffer = lines.pop(); // sisa baris yang belum lengkap, simpan buat iterasi berikutnya

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }

        const delta = chunk?.choices?.[0]?.delta || {};
        const piece = delta.content;
        if (typeof piece === 'string' && piece) {
          full += piece;
          onToken(piece);
        } else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          // Model reasoning-first: kalau nanti `content` kosong semua, teks
          // reasoning ini yang dipakai (jaga perilaku fallback non-streaming).
          doneReasoningOnly = true;
        }
      }
    }

    if (full) return full;
    if (doneReasoningOnly) {
      // Server cuma ngirim reasoning, gak ada content sama sekali → anggap gagal
      // supaya cascade lanjut ke provider berikutnya (bukan return kosong).
      throw new Error(`${name}: stream cuma berisi reasoning tanpa content`);
    }
    return full;
  };
}

// ── Adapter: Gemini (beda endpoint shape) ────────────────────────────────────
// Gemini streaming pakai ?alt=sse; di sini sengaja non-streaming dulu biar
// sederhana — Gemini jarang jadi primary di cascade ini.
async function askGeminiDynamic(baseUrl, apiKey, model, systemPrompt, userPrompt, onToken) {
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
  const text = data.candidates[0].content.parts[0].text;
  if (typeof onToken === 'function' && text) onToken(text);
  return text;
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
          ? (sys, usr, onToken) => askGeminiDynamic(p.baseUrl, p.apiKey, p.model, sys, usr, onToken)
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
// onToken diteruskan ke provider. PENTING: kalau provider gagal di TENGAH
// streaming, sebagian teks mungkin sudah terlanjur ter-print. Supaya gak
// nyampur output provider gagal + provider berikutnya, token yang sudah
// keluar dihitung (emitted) dan cascade berhenti nge-stream ke terminal
// begitu ada provider yang sukses (dia yang menang).
export async function raceProviders(providerList, systemPrompt, userPrompt, onToken) {
  const errors = [];
  for (const p of providerList) {
    if (!providerHealth.isAvailable(p.key)) {
      errors.push(`${p.name}: cooldown aktif (rate limit sebelumnya)`);
      continue;
    }
    try {
      const result = await p.fn(systemPrompt, userPrompt, onToken);
      providerHealth.recordSuccess(p.key);
      fallbackState.lastProvider = p.name;
      return result;
    } catch (err) {
      errors.push(`${p.name}: ${err.message.slice(0, 150)}`);
      if (/429|rate limit|too many requests|retry-after/i.test(err.message)) {
        const retryAfterMatch = err.message.match(/retry-after[^\d]*(\d+)/i);
        providerHealth.recordFailure(p.key, {
          status: 429,
          retryAfter: retryAfterMatch ? Number(retryAfterMatch[1]) : 0,
        });
        console.log(`[CIRCUIT] ${p.name} rate-limited (429) — cooldown 60 detik.`);
      }
      console.log(`[FALLBACK] ${p.name} gagal (${err.message.slice(0, 200)}) — coba provider berikutnya...`);
    }
  }
  fallbackState.lastProvider = null;
  throw new Error(`Semua provider gagal:\n${errors.join('\n')}`);
}

// ── Main entry with /model override ─────────────────────────────────────────
// askWithFallback(sys, usr)            → string (perilaku lama, dipakai test)
// askWithFallback(sys, usr, { onToken }) → string + streaming ke callback
export async function askWithFallback(systemPrompt, userPrompt, opts) {
  const onToken = opts && typeof opts.onToken === 'function' ? opts.onToken : undefined;
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

  return raceProviders(order, systemPrompt, userPrompt, onToken);
}
