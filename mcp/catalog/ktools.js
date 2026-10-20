/**
 * mcp/catalog/ktools.js — K's Tools connector.
 *
 * Server MCP buat fungsi belajar/ringkas (Ringkas, K's Tools for School).
 * URL diambil dari env `MCP_SERVER_URL` — JANGAN hardcode endpoint di source,
 * supaya file ini aman di-commit (lihat aturan: .env & .settings.json di-gitignore).
 *
 * Isi `MCP_SERVER_URL` di .env, contoh:
 *   MCP_SERVER_URL=https://contoh-host/mcp
 *
 * @type {{ id: string, name: string, url: string|null, description: string, envUrlVar: string, envKeyVar?: string }}
 */
export default {
  id: 'ktools',
  name: "K's Tools",
  url: null,                                  // wajib dari env, jangan hardcode
  description: "Summarize dan tools belajar (Ringkas, K's Tools for School)",
  envUrlVar: 'MCP_SERVER_URL',
  envKeyVar: 'MCP_SERVER_API_KEY',            // opsional, kalau server butuh auth
};
