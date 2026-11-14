// M48: bridge JS→Go untuk fsutil.
// Kalau binary Go ada, operasi async harus lewat Go dan hasilnya identik
// dengan implementasi JS. Kalau binary tidak ada, fallback JS tetap jalan.
import { readFileRange, readFileRangeAsync, listDirSafe, listDirSafeAsync, readFileSafe, readFileSafeAsync, goBridgeStatus } from '../src/utils/fs.js';
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const status = goBridgeStatus();
console.log(`  (bridge Go: ${status.available ? 'tersedia' : 'TIDAK ADA — fallback JS'})`);

// Fixture di dalam repo (biar lolos isSafePath).
const fixture = path.join(process.cwd(), '.tmp-go-bridge-test.txt');
const lines = Array.from({ length: 500 }, (_, i) => `baris-${i + 1}`);
fs.writeFileSync(fixture, lines.join('\n'));

// Fixture .env — JANGAN bergantung .env asli (gitignored, gak ada di clone bersih).
// Test ini dulu rapuh: expect .env ada, padahal cuma ada di mesin dev.
const envFixture = path.join(process.cwd(), '.env');
const envExisted = fs.existsSync(envFixture);
if (!envExisted) fs.writeFileSync(envFixture, 'DUMMY=1\n');

try {
  // 1. readFileRange: JS vs Go harus identik
  const jsRange = readFileRange(fixture, 10, 5);
  const goRange = await readFileRangeAsync(fixture, 10, 5);
  check('readFileRange: ok sama', jsRange.ok === goRange.ok);
  check('readFileRange: content identik', jsRange.content === goRange.content);
  check('readFileRange: totalLines sama', jsRange.totalLines === goRange.totalLines);
  check('readFileRange: start/end sama', jsRange.start === goRange.start && jsRange.end === goRange.end);

  // 2. listDirSafe: JS vs Go harus identik
  const jsList = listDirSafe('.');
  const goList = await listDirSafeAsync('.');
  check('listDirSafe: hasil identik', jsList === goList);

  // 3. readFileSafe: file terblokir
  const jsSafe = readFileSafe('.env');
  const goSafe = await readFileSafeAsync('.env');
  check('readFileSafe(.env): identik', jsSafe === goSafe);
  check('readFileSafe(.env): ACCESS DENIED', goSafe.includes('ACCESS DENIED'));

  // 4. file hilang
  const jsMissing = readFileRange('gak-ada-sama-sekali.txt', 1, 5);
  const goMissing = await readFileRangeAsync('gak-ada-sama-sekali.txt', 1, 5);
  check('file hilang: error sama', jsMissing.error === goMissing.error);
  check('file hilang: content sama', jsMissing.content === goMissing.content);

  // 5. clamp offset/limit
  const jsClamp = readFileRange(fixture, -5, -10);
  const goClamp = await readFileRangeAsync(fixture, -5, -10);
  check('clamp negatif: identik', jsClamp.start === goClamp.start && jsClamp.end === goClamp.end);
} finally {
  fs.unlinkSync(fixture);
  // Hapus .env fixture HANYA kalau kita yang bikin (jangan hapus .env asli user).
  if (!envExisted) { try { fs.unlinkSync(envFixture); } catch { /* ignore */ } }
}

console.log(`\n=== HASIL GO-BRIDGE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
