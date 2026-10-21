// M26 RED/GREEN: redirect + DNS/private-IP guards.
import { fetchWebPage } from '../src/web-fetch.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const fake = (responses) => async (url) => {
  const r = responses[url];
  if (!r) throw new Error(`unexpected URL ${url}`);
  return new Response(r.body || '', { status: r.status || 200, headers: r.headers || { 'content-type': 'text/plain' } });
};

const redirect = await fetchWebPage('https://public.test/start', {
  resolveFn: async () => ['93.184.216.34'],
  fetchFn: fake({
    'https://public.test/start': { status: 302, headers: { location: 'http://127.0.0.1/admin', 'content-type': 'text/plain' } },
  }),
});
check('redirect ke loopback ditolak', redirect.ok === false && /private|redirect|blocked/i.test(redirect.error || ''));

const dns = await fetchWebPage('https://public.test/data', {
  resolveFn: async () => ['127.0.0.1'],
  fetchFn: async () => new Response('secret', { status: 200, headers: { 'content-type': 'text/plain' } }),
});
check('hostname yang resolve private ditolak', dns.ok === false && dns.error === 'blocked_private_ip');

const publicDns = await fetchWebPage('https://public.test/data', {
  resolveFn: async () => ['93.184.216.34'],
  fetchFn: async () => new Response('aman', { status: 200, headers: { 'content-type': 'text/plain' } }),
});
check('hostname publik boleh', publicDns.ok === true && publicDns.text === 'aman');

console.log(`\n=== HASIL WEB-FETCH-HARDENING: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
