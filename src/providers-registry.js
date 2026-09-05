// src/providers-registry.js — Provider JSON registry with chmod 600 permission
// Storage: .setting.json
// TS-ready: JSDoc typed

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..'); // root repo (src/../ = root)
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');

/**
 * @typedef {Object} ProviderConfig
 * @property {string} name
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} model
 * @property {boolean} active
 */

// 7 Default Providers bawaan (seed)
const DEFAULT_PROVIDERS = [
  {
    name: "xkiro-coder",
    baseUrl: "https://api.xkiro.com/v1",
    apiKey: process.env.XKIRO_API_KEY || "",
    model: process.env.XKIRO_CODER_MODEL || "qwen/qwen3-coder-plus:free",
    active: true
  },
  {
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    active: true
  },
  {
    name: "xkiro",
    baseUrl: "https://api.xkiro.com/v1",
    apiKey: process.env.XKIRO_API_KEY || "",
    model: process.env.XKIRO_MODEL || "deepseek/deepseek-v4-pro",
    active: true
  },
  {
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
    active: true
  },
  {
    name: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: process.env.NVIDIA_API_KEY || "",
    model: process.env.NVIDIA_MODEL || "poolside/laguna-xs-2.1",
    active: true
  },
  {
    name: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: process.env.MISTRAL_API_KEY || "",
    model: process.env.MISTRAL_MODEL || "mistral-small-latest",
    active: true
  },
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
    active: true
  }
];

/**
 * Memuat list provider dari file.
 * Melakukan auto-seed jika file belum ada.
 * @returns {ProviderConfig[]}
 */
export function loadProviders() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(SETTINGS_PATH)) {
    // Seed default providers
    saveProviders(DEFAULT_PROVIDERS);
    return DEFAULT_PROVIDERS;
  }

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return DEFAULT_PROVIDERS;
   
    // Reconciliation: kalau ada provider yang apiKey-nya kosong di settings.json
    // TAPI ada env var yang cocok, backfill dari .env — biar .env tetap jadi
    // jaring pengaman seterusnya, bukan cuma dipake sekali doang pas file lahir.
    // Nama env var diturunin otomatis dari nama provider: "nvidia" -> NVIDIA_API_KEY.
    // Tanda hubung "-" diganti "_". Kalau nanti nambah provider baru, otomatis
    // kebaca tanpa perlu tambah mapping manual di sini.
    const toEnvName = (providerName) =>
     providerName.toUpperCase().replace(/-/g, '_') + '_API_KEY';
     
     // Pengecualian: "xkiro-coder" numpang 1 API key yang sama dengan "xkiro"
    // (1 akun xKiro dipakai buat 2 model berbeda), bukan XKIRO_CODER_API_KEY.
     const envNameOverride = { 'xkiro-coder': 'XKIRO_API_KEY' };
     
     const getEnvKey = (providerName) => {
       const envName = envNameOverride[providerName] || toEnvName(providerName);
       return process.env[envName];
     }
     
    let healed = false;
    
    for (const p of parsed) {
      if (!p.apiKey && getEnvKey[p.name]) {
        p.apiKey = getEnvKey[p.name];
        healed = true;
      }
    }
    if (healed) saveProviders(parsed); 
    
    return parsed;
  } catch {
    return DEFAULT_PROVIDERS;
  }
}

/**
 * Menulis list provider dengan atomic write dan aman (chmod 600).
 * @param {ProviderConfig[]} list
 */
export function saveProviders(list) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const jsonStr = JSON.stringify(list, null, 2);
  
  // Validasi agar tidak corrupt (bisa di-parse balik)
  try {
    JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Data provider tidak valid untuk stringify: ${err.message}`);
  }

  // Atomic write menggunakan temporary file
  const tmpPath = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, jsonStr, 'utf8');
  fs.renameSync(tmpPath, SETTINGS_PATH);

  // Set file permission chmod 600 agar hanya owner yang bisa baca/tulis
  try {
    fs.chmodSync(SETTINGS_PATH, 0o600);
  } catch (err) {
    // Fallback shell command jika platform butuh chmod CLI
    try {
      execSync(`chmod 600 "${SETTINGS_PATH}"`);
    } catch {
      console.warn('[WARN] Gagal set chmod 600 pada settings.json');
    }
  }
}

/**
 * Tambah provider baru.
 * Auto-append /chat/completions di URL jika bukan Gemini atau jika tidak diakhiri /v1.
 */
export function addProvider({ name, baseUrl, apiKey, model, active = true }) {
  const list = loadProviders();
  const existingIdx = list.findIndex(p => p.name === name);

  // Normalisasi baseUrl polos jika dibutuhkan
  let cleanUrl = baseUrl.trim();
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1);
  }

  const newProvider = {
    name: name.trim().toLowerCase(),
    baseUrl: cleanUrl,
    apiKey: apiKey.trim(),
    model: (model || "qwen/qwen3-coder-plus:free").trim(),
    active
  };

  if (existingIdx >= 0) {
    list[existingIdx] = newProvider;
  } else {
    list.push(newProvider);
  }

  saveProviders(list);
  return newProvider;
}

/**
 * Hapus provider berdasarkan nama.
 * @param {string} name
 */
export function removeProvider(name) {
  const list = loadProviders();
  const filtered = list.filter(p => p.name !== name.trim().toLowerCase());
  saveProviders(filtered);
  return filtered;
}

/**
 * Jadikan provider sebagai prioritas pertama (primary) di cascade list.
 * @param {string} name
 */
export function setPrimary(name) {
  const list = loadProviders();
  const idx = list.findIndex(p => p.name === name.trim().toLowerCase());
  if (idx < 0) throw new Error(`Provider "${name}" tidak ditemukan.`);

  const [chosen] = list.splice(idx, 1);
  const updatedList = [chosen, ...list];
  saveProviders(updatedList);
  return updatedList;
}

/**
 * Update API Key provider yang sudah ada tanpa mengubah parameter lain.
 * @param {string} name
 * @param {string} newKey
 */
export function updateApiKey(name, newKey) {
  const list = loadProviders();
  const provider = list.find(p => p.name === name.trim().toLowerCase());
  if (!provider) throw new Error(`Provider "${name}" tidak ditemukan.`);

  provider.apiKey = newKey.trim();
  saveProviders(list);
  return provider;
}
