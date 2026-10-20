// tests/test-autoroute-runtime.mjs — Uji auto-routing dengan MENJALANKAN kode,
// bukan cuma baca teks file.
//
// Kenapa ini ada: test-autoroute-wiring.mjs cuma regex baca repl.js — dan itu
// LOLOS padahal ada bug `instruction` const yang bikin REPL crash saat
// auto-route nyuntik prefix. Regex gak bisa nangkep bug runtime.
//
// Test ini nge-drive REPL beneran lewat child_process dengan stdin PTY-less,
// lalu ngecek outputnya. Gak manggil LLM: kita masukin task SIMPEL dulu
// (yang harusnya single-agent), baru cek perilakunya.
//
// Written by K-sRouter

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

/** Jalanin REPL buat beberapa baris input, balikin stdout+stderr mentah.
 *  PENTING: kasih jeda antar baris. REPL pakai TUI yang nge-overwrite baris,
 *  jadi kalau semua input dikirim sekaligus cuma baris pertama yang diproses. */
async function runREPL(lines, { settleMs = 900, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, K_SROUTER_NO_COLOR: '1' },
    });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.on('close', () => { clearTimeout(timer); resolve(out); });

    (async () => {
      await new Promise(r => setTimeout(r, 1800)); // tunggu banner + prompt siap
      for (const line of lines) {
        child.stdin.write(line + '\n');
        await new Promise(r => setTimeout(r, settleMs));
      }
      try { child.stdin.end(); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1200);
    })();
  });
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');

console.log('\n[1] /route command jalan di REPL beneran');
{
  const out = strip(await runREPL(['/route', '/exit']));
  check('nampilin status auto-routing', /Auto-routing ke squad: (AKTIF|MATI)/.test(out));
  check('nampilin cara kontrol', /\/route on \| \/route off/.test(out));
}

console.log('\n[2] /route test ngeksekusi heuristik (bukan crash)');
{
  const out = strip(await runREPL([
    '/route test riset cara kerja X lalu bikin kodenya',
    '/route test baca src/ui.js terus ringkas',
    '/exit',
  ], { settleMs: 1300, timeoutMs: 40000 }));
  check('task kompleks → SQUAD', /Hasil routing: SQUAD/.test(out));
  check('task simpel → SINGLE', /Hasil routing: SINGLE/.test(out));
  check('nampilin confidence', /confidence\s*:\s*(high|medium|low)/.test(out));
  check('nampilin sinyal', /sinyal urutan/.test(out));
  check('gak ada crash "Assignment to constant"', !/Assignment to constant/.test(out));
  check('gak ada "Boot failed"', !/Boot failed/.test(out));
}

console.log('\n[3] REGRESI BUG: auto-route nyuntik /squad tanpa crash');
{
  // Ini bug yang ketangkep live: `instruction` dulu const, jadi assignment
  // ke dia meledak. Kita set autoRoute on lewat env, masukin task kompleks.
  // Kita cegah LLM beneran jalan dengan timeout pendek — yang penting:
  // output HARUS nunjukin "Auto-route → squad" dan TIDAK "Assignment to constant".
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, K_SROUTER_AUTOROUTE: '1', K_SROUTER_NO_COLOR: '1' },
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  await new Promise(r => setTimeout(r, 2500));
  child.stdin.write('riset cara kerja debounce lalu bikin implementasinya\n');
  await new Promise(r => setTimeout(r, 6000));
  try { child.kill('SIGKILL'); } catch {}
  await new Promise(r => setTimeout(r, 400));
  const O = strip(out);

  check('autoRoute dari env K_SROUTER_AUTOROUTE=1 kebaca',
    /Auto-route\s*→\s*squad/.test(O), O.slice(-300));
  check('TIDAK crash "Assignment to constant variable"',
    !/Assignment to constant/.test(O));
  check('TIDAK "Boot failed"', !/Boot failed/.test(O));
  check('masuk jalur squad (nyusun rencana / langkah)',
    /rencana|LANGKAH|SQUAD|Menganalisis/i.test(O), O.slice(-300));

  // Yang paling penting: proses HARUS masih hidup / mati karena kita kill,
  // bukan mati sendiri karena exception.
  check('proses gak mati sendiri karena error',
    !/Boot failed|ReferenceError|TypeError/.test(O));
}

console.log('\n[4] Task simpel TIDAK dirouting ke squad walau autoRoute on');
{
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, K_SROUTER_AUTOROUTE: '1', K_SROUTER_NO_COLOR: '1' },
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  await new Promise(r => setTimeout(r, 2500));
  // Task simpel + perintah /mode → TIDAK boleh ke squad.
  child.stdin.write('/mode\n');
  await new Promise(r => setTimeout(r, 3000));
  try { child.kill('SIGKILL'); } catch {}
  await new Promise(r => setTimeout(r, 400));
  const O = strip(out);
  check('command /mode TIDAK dirouting ke squad',
    !/Auto-route\s*→\s*squad/.test(O));
  check('/mode tetap nampilin mode aktif', /Mode approval aktif/.test(O));
}

console.log('\n[5] Command /help nampilin /mode dan /route');
{
  const out = strip(await runREPL(['/help', '/exit']));
  check('/help nyebut /mode', /\/mode/.test(out));
  check('/help nyebut /route', /\/route/.test(out));
}

console.log(`\n=== HASIL RUNTIME: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
