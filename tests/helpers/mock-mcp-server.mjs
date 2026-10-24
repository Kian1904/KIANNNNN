// tests/helpers/mock-mcp-server.mjs — Mock MCP Streamable HTTP server.
//
// Dipakai buat ngetes mcp/client.js tanpa server external:
//   - initialize / tools/list / tools/call (JSON-RPC 2.0)
//   - mcp-session-id  (handshake session stateful)
//   - mode JSON polos  → `http://host:port/mcp`
//   - mode SSE stream  → `http://host:port/mcp?sse=1`  (Content-Type: text/event-stream)
//
// Zero-dependency (node:http doang) — konsisten sama repo yang cuma chalk+dotenv.
// Written by K'

import http from 'node:http';

/**
 * Tool summarize palsu: balikin poin dari teks.
 * Sengaja sederhana — yang dites kontrak transport, bukan kualitas ringkasan.
 */
function fakeSummarize(args) {
  const teks = String(args?.teks ?? '');
  const kalimat = teks.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  if (args?.mode === 'poin') {
    return kalimat.slice(0, 3).map(s => `- ${s}`).join('\n');
  }
  return kalimat.slice(0, 2).join('. ') + (kalimat.length ? '.' : '(kosong)');
}

const TOOLS = [
  {
    name: 'summarize',
    description: 'Ringkas teks jadi poin atau kalimat pendek.',
    inputSchema: {
      type: 'object',
      properties: {
        teks: { type: 'string', description: 'Teks sumber' },
        mode: { type: 'string', enum: ['poin', 'kalimat'], description: 'Gaya output' },
      },
      required: ['teks'],
    },
  },
  {
    name: 'echo',
    description: 'Balikin argumen apa adanya (buat tes arg passthrough).',
    inputSchema: { type: 'object', properties: { pesan: { type: 'string' } } },
  },
];

/**
 * Handle satu request JSON-RPC.
 * @returns {{ result?: any, error?: {code:number,message:string} }}
 */
function dispatch(body) {
  const { method, params } = body || {};
  switch (method) {
    case 'initialize':
      return {
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp', version: '1.0.0' },
        },
      };
    case 'notifications/initialized':
      return { result: {} };
    case 'tools/list':
      return { result: { tools: TOOLS } };
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      if (name === 'summarize') {
        if (typeof args.teks !== 'string') {
          return { error: { code: -32602, message: 'teks wajib string' } };
        }
        return { result: { content: [{ type: 'text', text: fakeSummarize(args) }] } };
      }
      if (name === 'echo') {
        return { result: { content: [{ type: 'text', text: JSON.stringify(args) }] } };
      }
      return { error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/**
 * Jalankan mock server. Caller WAJIB tutup lewat returned .close().
 * @param {{ sseDefault?: boolean }} [opts]
 * @returns {Promise<{ url: string, sseUrl: string, close: () => Promise<void>, port: number }>}
 */
export async function startMockMcpServer(opts = {}) {
  const sessions = new Set();
  let sessionSeq = 0;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'POST only' } }));
      return;
    }

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); }
      catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      // Session handshake: initialize bikin session baru, request lain wajib ngirim
      // balik mcp-session-id-nya (client nyimpen dari response header).
      const headers = { 'Content-Type': 'application/json' };
      const isInit = body?.method === 'initialize';
      if (isInit) {
        const sid = `sess-${++sessionSeq}-${Date.now()}`;
        sessions.add(sid);
        headers['mcp-session-id'] = sid;
      } else {
        const sid = req.headers['mcp-session-id'];
        if (sid && !sessions.has(sid)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null,
            error: { code: -32000, message: `Unknown session: ${sid}` } }));
          return;
        }
      }

      const out = { jsonrpc: '2.0', id: body?.id ?? null, ...dispatch(body) };
      const payload = JSON.stringify(out);

      // Mode SSE kalau diminta via ?sse=1 (client parse: cari baris `data:` terakhir
      // yang valid JSON).
      const wantSse = new URL(req.url, 'http://x').searchParams.get('sse') === '1';
      if (wantSse) {
        headers['Content-Type'] = 'text/event-stream';
        res.writeHead(200, headers);
        res.write(`event: message\ndata: ${payload}\n\n`);
        res.end();
        return;
      }

      res.writeHead(200, headers);
      res.end(payload);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/mcp`;

  return {
    port,
    url: base,
    sseUrl: `${base}?sse=1`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
