// M23: web_fetch — ambil isi halaman hasil riset, bukan cuma snippet.
import { fetchWebPage } from '../src/web-fetch.js';

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

(async () => {
  console.log('\n[1] web_fetch — HTML jadi teks yang bisa dibaca model');
  const html = '<html><head><title>Cuaca</title><style>.x{}</style></head><body>' +
    '<h1>Prakiraan Jakarta</h1><p>Malam ini hujan ringan, suhu 25°C.</p>' +
    '<script>alert(1)</script></body></html>';
  const ok = await fetchWebPage('https://bmkg.test/cuaca', {
    fetchFn: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
  });
  check('ok:true', ok.ok === true);
  check('URL dipertahankan', ok.url === 'https://bmkg.test/cuaca');
  check('judul/isi masuk', ok.text.includes('Prakiraan Jakarta') && ok.text.includes('hujan ringan'));
  check('script/style dibuang', !ok.text.includes('alert') && !ok.text.includes('.x'));
  check('content type tercatat', ok.contentType.includes('text/html'));

  console.log('\n[2] web_fetch — fail-closed URL dan ukuran');
  const ftp = await fetchWebPage('ftp://example.com/file', { fetchFn: async () => { throw new Error('jangan dipanggil'); } });
  check('protocol selain http/https ditolak', ftp.ok === false && ftp.error === 'blocked_url');
  const tooBig = await fetchWebPage('https://example.test/big', {
    maxBytes: 20,
    fetchFn: async () => new Response('ini lebih panjang dari batas', { status: 200, headers: { 'content-type': 'text/plain' } }),
  });
  check('body terlalu besar ditolak', tooBig.ok === false && tooBig.error === 'too_large');

  console.log('\n[3] web_fetch — HTTP error, timeout, dan non-text');
  const notFound = await fetchWebPage('https://example.test/404', {
    fetchFn: async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
  });
  check('HTTP error tidak dianggap sukses', notFound.ok === false && notFound.status === 404);
  const binary = await fetchWebPage('https://example.test/a.png', {
    fetchFn: async () => new Response('PNG', { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  check('non-text ditolak', binary.ok === false && binary.error === 'non_text');
  const timeout = await fetchWebPage('https://example.test/slow', {
    timeoutMs: 10,
    fetchFn: (_url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  check('timeout terkontrol', timeout.ok === false && timeout.error === 'timeout');

  console.log('\n[4] plan parser — web_fetch');
  const { planStep } = await import('../src/plan.js');
  const ctx = { instruction: 'cek cuaca', fileSnapshot: '', history: [], agentMd: '', recentMemory: '', availableTools: [], webSearchCount: 1 };
  const step = await planStep(async () => 'REASONING: snippet kurang\nACTION: web_fetch\nURL: https://bmkg.go.id/cuaca', ctx);
  check('ACTION web_fetch diparse', step.action === 'web_fetch' && step.url === 'https://bmkg.go.id/cuaca');
  let missingUrl = false;
  try { await planStep(async () => 'REASONING: fetch\nACTION: web_fetch', ctx); } catch (err) { missingUrl = /tidak ada URL/i.test(err.message); }
  check('web_fetch tanpa URL ditolak', missingUrl);

  console.log(`\n=== HASIL WEB-FETCH: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
