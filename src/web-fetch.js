// M23/M26/M33: fetch halaman web dengan guard ukuran/protokol + fokus data relevan.
import dns from 'dns';

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 600_000;
const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml))/i;

function blockedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'blocked_url'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'blocked_url';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'blocked_url';
  return null;
}

function isPrivateIp(ip) {
  const s = String(ip).toLowerCase();
  return s === '::1' || s === '0.0.0.0' || /^127\./.test(s) || /^10\./.test(s) ||
    /^192\.168\./.test(s) || /^169\.254\./.test(s) || /^172\.(1[6-9]|2\d|3[01])\./.test(s) ||
    /^(fc|fd|fe80:)/i.test(s);
}

async function resolvePublic(host, resolveFn) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    return isPrivateIp(host) ? { ok: false, error: 'blocked_private_ip' } : { ok: true };
  }
  const addresses = await resolveFn(host);
  return addresses.some(isPrivateIp) ? { ok: false, error: 'blocked_private_ip' } : { ok: true };
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
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Buang navigasi umum, pertahankan blok yang memuat istilah query/data.
export function focusWebText(text, query = '') {
  const raw = String(text);
  let lines;
  try {
    const parsed = JSON.parse(raw);
    const flat = [];
    const walk = (value, key = '') => {
      if (Array.isArray(value)) return value.forEach(v => walk(v, key));
      if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => walk(v, k));
      if (value !== null && value !== undefined) flat.push(`${key}: ${value}`);
    };
    walk(parsed);
    lines = flat;
  } catch {
    lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
  }
  const q = String(query).toLowerCase().split(/\s+/).filter(x => x.length > 2);
  const noise = /^(tentang bmkg|profil$|struktur organisasi|pejabat eselon|balai besar|publikasi$|siaran pers|berita utama|berita kegiatan|berita daerah|artikel$|pengumuman|kegiatan internasional|pelayanan publik|ppid bmkg|pelayanan satu pintu|layanan pengadaan|e-pengaduan|pengaduan masyarakat|laporan harta|media sosial|footer|badan meteorologi,|196 contact)/i;
  const data = /jakarta|suhu|temp|feelslike|humidity|kelembapan|hujan|cerah|berawan|kabut|smoky haze|angin|wind|°c|%|prakiraan|cuaca|weather|pressure|visibility/i;
  const kept = lines.filter(line => !noise.test(line) && (data.test(line) || q.some(term => line.toLowerCase().includes(term))));
  const result = kept.length >= 1 ? kept : lines.filter(line => !noise.test(line));
  return result.join('\n').slice(0, 12000);
}

export function buildWebEvidenceSummary(history = []) {
  return history.filter(h => h.action === 'web_fetch').map(h => {
    const focused = focusWebText(h.summary || '', h.query || '');
    return `${h.url}:\n${focused.slice(0, 900)}`;
  }).join('\n\n').slice(0, 3000);
}

async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: 'too_large' };
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    return Buffer.byteLength(text) > maxBytes ? { error: 'too_large' } : { text };
  }
  const reader = res.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { try { await reader.cancel(); } catch {} return { error: 'too_large' }; }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

export async function fetchWebPage(rawUrl, {
  fetchFn = globalThis.fetch,
  resolveFn = host => dns.promises.lookup(host, { all: true }).then(xs => xs.map(x => x.address)),
  timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxRedirects = DEFAULT_MAX_REDIRECTS,
} = {}) {
  let current = rawUrl;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const reason = blockedUrl(current); if (reason) return { ok: false, error: reason, url: current };
    try {
      const u = new URL(current); const resolved = await resolvePublic(u.hostname, resolveFn);
      if (!resolved.ok) return { ok: false, error: resolved.error, url: current };
    } catch (err) { return { ok: false, error: 'dns_error', message: err.message, url: current }; }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(current, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': 'K-sRouter-research/1.0', accept: 'text/html, text/plain, application/json;q=0.9, */*;q=0.1' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) return { ok: false, error: 'redirect_without_location', url: current };
        if (redirectCount === maxRedirects) return { ok: false, error: 'too_many_redirects', url: current };
        current = new URL(location, current).toString(); continue;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) return { ok: false, error: 'http_error', status: res.status, url: current };
      if (!TEXT_TYPES.test(contentType) && contentType) return { ok: false, error: 'non_text', status: res.status, url: current, contentType };
      const body = await readLimited(res, maxBytes); if (body.error) return { ok: false, error: body.error, status: res.status, url: current };
      const text = /html/i.test(contentType) || /<html[\s>]/i.test(body.text) ? htmlToText(body.text) : body.text.trim();
      return { ok: true, url: current, status: res.status, contentType, text: text.slice(0, 120_000) };
    } catch (err) { return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'fetch_error', message: err?.message || String(err), url: current }; }
    finally { clearTimeout(timer); }
  }
  return { ok: false, error: 'too_many_redirects', url: current };
}

export { htmlToText };
