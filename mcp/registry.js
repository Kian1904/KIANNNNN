/**
 * mcp/registry.js — Plugin registry untuk MCP connections
 * Storage: JSON di ~/.krouter_data/connections.json
 * TS-ready: pakai JSDoc untuk type annotations
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.krouter_data');
const CONNECTIONS_PATH = path.join(DATA_DIR, 'connections.json');

/**
 * @typedef {Object} McpTool
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 */

/**
 * @typedef {Object} McpConnection
 * @property {string} name        - Human-readable name (e.g. "K's Tools")
 * @property {string} url         - MCP server endpoint URL
 * @property {boolean} active     - Apakah connector ini aktif
 * @property {McpTool[]} tools    - Tools yang di-cache dari last discovery
 * @property {string} addedAt     - ISO timestamp kapan ditambahkan
 * @property {string|null} lastConnected - ISO timestamp last successful connect
 */

/** @returns {{ connections: McpConnection[] }} */
function loadStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONNECTIONS_PATH)) return { connections: [] };
  try {
    return JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
  } catch {
    return { connections: [] };
  }
}

/** @param {{ connections: McpConnection[] }} store */
function saveStore(store) {
  fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// ── Public API ────────────────────────────────────────────────────────────────

/** @returns {McpConnection[]} */
export function listConnections() {
  return loadStore().connections;
}

/** @returns {McpConnection[]} */
export function getActiveConnections() {
  return loadStore().connections.filter(c => c.active);
}

/** @param {string} name @returns {McpConnection|undefined} */
export function getConnection(name) {
  return loadStore().connections.find(c => c.name === name);
}

/**
 * Tambah atau update connection.
 * @param {{ name: string, url: string, active?: boolean }} opts
 * @returns {McpConnection}
 */
export function addConnection({ name, url, active = true }) {
  const store = loadStore();
  const existing = store.connections.findIndex(c => c.name === name);
  /** @type {McpConnection} */
  const conn = {
    name,
    url,
    active,
    tools: [],
    addedAt: new Date().toISOString(),
    lastConnected: null,
    ...(existing >= 0 ? store.connections[existing] : {}),
    // Override nama/url kalau ada update
    name, url, active
  };
  if (existing >= 0) store.connections[existing] = conn;
  else store.connections.push(conn);
  saveStore(store);
  return conn;
}

/**
 * Toggle active status.
 * @param {string} name
 * @returns {boolean} status baru
 */
export function toggleConnection(name) {
  const store = loadStore();
  const conn = store.connections.find(c => c.name === name);
  if (!conn) throw new Error(`Connector "${name}" tidak ditemukan.`);
  conn.active = !conn.active;
  saveStore(store);
  return conn.active;
}

/**
 * Update cached tools setelah discovery.
 * @param {string} name
 * @param {McpTool[]} tools
 */
export function updateTools(name, tools) {
  const store = loadStore();
  const conn = store.connections.find(c => c.name === name);
  if (!conn) return;
  conn.tools = tools;
  conn.lastConnected = new Date().toISOString();
  saveStore(store);
}

/**
 * Hapus connection.
 * @param {string} name
 */
export function removeConnection(name) {
  const store = loadStore();
  store.connections = store.connections.filter(c => c.name !== name);
  saveStore(store);
}

/** @returns {string} path ke connections.json */
export function getRegistryPath() {
  return CONNECTIONS_PATH;
}
