// lib/mcp.js — MCP client

const MCP_URL = process.env.MCP_SERVER_URL;
const MCP_TIMEOUT_MS = 30000;

async function mcpRequest(method, params = {}) {
  if (!MCP_URL) throw new Error('MCP_SERVER_URL belum di-set di .env');
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`MCP server error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`MCP [${data.error.code}]: ${data.error.message}`);
  return data.result;
}

export async function discoverTools() {
  if (!MCP_URL) {
    console.log('[MCP] MCP_SERVER_URL tidak di-set di .env — MCP dilewati.');
    return [];
  }
  try {
    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'k-srouter', version: '1.0.0' },
      capabilities: {}
    });
    const result = await mcpRequest('tools/list');
    return (result.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || null
    }));
  } catch (err) {
    console.warn(`[MCP] Gagal discover tools: ${err.message}`);
    return [];
  }
}

export async function callTool(name, args) {
  const result = await mcpRequest('tools/call', { name, arguments: args });
  return result.content?.map(c => c.text || '').join('\n') || JSON.stringify(result);
}
