/**
 * mcp/catalog/index.js — Known MCP connectors.
 * Tambah entry baru di sini kalau ada connector baru yang stabil dan sering dipakai.
 *
 * Setiap entry: { id, name, url, description, envUrlVar, envKeyVar? }
 *   - url: fallback default (boleh null kalau wajib dari env)
 *   - envUrlVar: nama env var yang menimpa url (biar gak hardcode di source)
 *   - envKeyVar: nama env var buat apiKey (opsional)
 *
 * @type {{ id: string, name: string, url: string|null, description: string, envUrlVar: string, envKeyVar?: string }[]}
 */
import ktools from './ktools.js';

/** @type {Array} */
export const CATALOG = [
  ktools,
  /* tambah connector lain di sini */
];

/**
 * Resolve URL + apiKey dari env, lalu buang entry yang URL-nya kosong.
 * Dipakai `/connect catalog` buat daftar connector yang BENERAN bisa dipakai
 * di environment ini (bukan nampilin entry yang env-nya belum diisi).
 *
 * @returns {{ id: string, name: string, url: string, apiKey: string|null, description: string }[]}
 */
export function resolveCatalog(env = process.env) {
  const out = [];
  for (const entry of CATALOG) {
    const url = (entry.envUrlVar && env[entry.envUrlVar]) || entry.url || '';
    if (!url) continue; // env belum diisi → skip, jangan tampilkan connector mati
    const apiKey = entry.envKeyVar ? (env[entry.envKeyVar] || null) : null;
    out.push({
      id: entry.id,
      name: entry.name,
      url,
      apiKey,
      description: entry.description,
    });
  }
  return out;
}

/**
 * Cari entry catalog berdasarkan id.
 * @param {string} id
 */
export function findInCatalog(id) {
  return CATALOG.find(c => c.id === id) || null;
}
