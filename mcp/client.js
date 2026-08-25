/**
 * mcp/client.js — Multi-server MCP client
 * Replace lib/mcp.js setelah ini selesai ditest.
 *
 * @typedef {Object} McpTool
 * @property {string} name
 * @property {string} description
 * @property {Object} inputSchema
 * @property {string} _serverName   - dari server mana tool ini berasal
 * @property {string} _serverUrl    - URL server asalnya
 */

import { getActiveConnections, updateTools } from './registry.js';

const TIMEOUT_MS = 15000;

// Session ID per server (Streamable HTTP transport bisa stateful — server ngasih
// mcp-session-id di response initialize, kita wajib kirim balik di request setelahnya).
const sessionIds = new Map(); // url -> sessionId

/**
 * Parse response body MCP. Server Streamable HTTP boleh balikin JSON polos ATAU
 * SSE stream (Content-Type: text/event-stream) tergantung dia pilih mode apa.
 * @param {Response} res
 */
async function parseMcpResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const raw = await res.text();
    // SSE format: baris "data: {...json...}" — ambil baris data terakhir yang valid JSON
    const dataLines = raw.split('\n').filter(l => l.startsWith('data:'));
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try { return JSON.parse(dataLines[i].slice(5).trim()); }
      catch { /* coba baris sebelumnya */ }
    }
    throw new Error('SSE response tidak punya data JSON valid');
  }
  return res.json();
}

/** @param {string} url @param {string} method @param {Object} params @param {string|null} [apiKey] */
async function mcpRequest(url, method, params = {}, apiKey = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    'Content-Type': 'application/json',
    // WAJIB kedua tipe ini, atau server Streamable HTTP balikin 406 Not Acceptable
    'Accept': 'application/json, text/event-stream'
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const existingSession = sessionIds.get(url);
  if (existingSession) headers['mcp-session-id'] = existingSession;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: controller.signal
    });

    const newSession = res.headers.get('mcp-session-id');
    if (newSession) sessionIds.set(url, newSession);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await parseMcpResponse(res);
    if (data.error) throw new Error(`MCP [${data.error.code}]: ${data.error.message}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover tools dari semua active connections (parallel).
 * @returns {Promise<McpTool[]>}
 */
export async function discoverTools() {
  const connections = getActiveConnections();
  if (connections.length === 0) return [];

  const results = await Promise.allSettled(
    connections.map(async conn => {
      try {
        await mcpRequest(conn.url, 'initialize', {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'k-srouter', version: '1.0.0' },
          capabilities: {}
        }, conn.apiKey);
        const result = await mcpRequest(conn.url, 'tools/list', {}, conn.apiKey);
        const tools = (result.tools || []).map(t => ({
          ...t,
          _serverName: conn.name,
          _serverUrl: conn.url,
          _apiKey: conn.apiKey
        }));
        updateTools(conn.name, tools);
        return tools;
      } catch (err) {
        console.warn(`[MCP] ${conn.name} gagal: ${err.message}`);
        return [];
      }
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
}

/**
 * Call tool by name. Client tau harus ke server mana dari metadata tool.
 * @param {string} name
 * @param {Object} args
 * @param {McpTool[]} toolPool - dari discoverTools()
 * @returns {Promise<string>}
 */
export async function callTool(name, args, toolPool) {
  const tool = toolPool.find(t => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" tidak ditemukan di pool.`);

  const result = await mcpRequest(tool._serverUrl, 'tools/call', {
    name,
    arguments: args
  }, tool._apiKey);
  return result.content?.map(c => c.text || '').join('\n') || JSON.stringify(result);
}