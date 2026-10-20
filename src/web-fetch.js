// M23: fetch halaman web hasil search dengan guard ukuran/protokol.
// Tanpa dependency tambahan: HTML dibersihkan cukup untuk konteks LLM.

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 600_000;
const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml))/i;

function blockedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'blocked_url'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'blocked_url';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return 'blocked_url';
  }
  return null;
}

function htmlToText(input) {
  return String(input)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|main|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: 'too_large' };
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) return { error: 'too_large' };
    return { text };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { error: 'too_large' };
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

export async function fetchWebPage(rawUrl, {
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const reason = blockedUrl(rawUrl);
  if (reason) return { ok: false, error: reason, url: rawUrl };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(rawUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'K-sRouter-research/1.0', accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.1' },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) return { ok: false, error: 'http_error', status: res.status, url: rawUrl };
    if (!TEXT_TYPES.test(contentType) && contentType) return { ok: false, error: 'non_text', status: res.status, url: rawUrl, contentType };
    const body = await readLimited(res, maxBytes);
    if (body.error) return { ok: false, error: body.error, status: res.status, url: rawUrl };
    const text = /html/i.test(contentType) || /<html[\s>]/i.test(body.text) ? htmlToText(body.text) : body.text.trim();
    return { ok: true, url: rawUrl, status: res.status, contentType, text: text.slice(0, 120_000) };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'fetch_error', message: err?.message || String(err), url: rawUrl };
  } finally { clearTimeout(timer); }
}

export { htmlToText };
