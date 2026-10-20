// tests/helpers/mock-sse-server.mjs — Mock OpenAI-compatible SSE server.
//
// Buat ngetes jalur streaming di src/providers.js tanpa manggil provider asli:
//   - POST /v1/chat/completions  (stream:false) → JSON biasa
//   - POST /v1/chat/completions  (stream:true)  → text/event-stream, chunk per kata
//   - ?mode=json-ignores-stream  → provider "budek" yang balikin JSON walau
//     diminta stream (uji fallback deteksi Content-Type)
//   - ?mode=reasoning-only       → stream cuma berisi reasoning_content
//     (uji: dianggap gagal, cascade lanjut)
//
// Zero-dependency (node:http).
// Written by K-sRouter

import http from 'node:http';

const DEFAULT_TOKENS = ['Halo', ' ', 'dari', ' ', 'mock', '!'];

/**
 * @param {{ tokens?: string[] }} [opts]
 * @returns {Promise<{ url: string, close: () => Promise<void>, port: number, requests: any[] }>}
 */
export async function startMockSseServer(opts = {}) {
  const tokens = opts.tokens || DEFAULT_TOKENS;
  const requests = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const mode = url.searchParams.get('mode') || 'normal';

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST only' }));
      return;
    }

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad json' }));
        return;
      }
      requests.push(body);

      const wantsStream = body.stream === true;
      const joined = tokens.join('');

      // Provider budek: diminta stream tapi balikin JSON biasa.
      if (mode === 'json-ignores-stream') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: joined } }] }));
        return;
      }

      // Stream cuma reasoning, tanpa content sama sekali.
      if (mode === 'reasoning-only') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'mikir...' } }] }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (!wantsStream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: joined } }] }));
        return;
      }

      // Jalur SSE beneran: satu chunk per token.
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of tokens) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
