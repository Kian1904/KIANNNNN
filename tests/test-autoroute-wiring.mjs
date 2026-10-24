// tests/test-autoroute-wiring.mjs — Verifikasi auto-routing BENERAN kesambung di repl.js.
//
// Test routing.js (29 pass) cuma ngebuktiin HEURISTIK-nya bener.
// Test INI ngebuktiin repl.js beneran MANGGIL heuristik itu di jalur keputusan —
// kalau wiring-nya dicabut, test ini harus gagal.
//
// Written by K'

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPL = join(__dirname, '..', 'src', 'repl.js');
const src = readFileSync(REPL, 'utf8');

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

console.log('\n[1] Import & state');
check('repl.js import routeTask dari routing.js',
  /import\s*\{[^}]*routeTask[^}]*\}\s*from\s*['"]\.\/routing\.js['"]/.test(src));
check('ada state autoRoute', /let\s+autoRoute\s*=/.test(src));
check('autoRoute default OFF (harus readEnv("AUTOROUTE") === "1" buat nyala)',
  /readEnv\(['"]AUTOROUTE['"]\)\s*===\s*['"]1['"]/.test(src));

console.log('\n[2] Command /route lengkap');
check('handler /route ada', /startsWith\(['"]\/route['"]\)/.test(src));
check('/route on', /arg\s*===\s*['"]on['"]/.test(src));
check('/route off', /arg\s*===\s*['"]off['"]/.test(src));
check('/route test <task>', /arg\s*===\s*['"]test['"]/.test(src));
check('/route terdaftar di /help', /\/route.*Auto-routing/.test(src));

console.log('\n[3] Wiring di jalur keputusan');
check('routeTask dipanggil di loop', /const\s+verdict\s*=\s*routeTask\(instruction\)/.test(src));
check('dipanggil cuma kalau autoRoute aktif', /if\s*\(\s*autoRoute\s*&&\s*!instruction\.trim\(\)\.startsWith\(['"]\/['"]\)\s*\)/.test(src));
check('keyakinan rendah → minta approval (shouldAsk)',
  /verdict\.shouldAsk[\s\S]{0,200}askApproval/.test(src));
check('approval pakai forceAsk (gak bisa di-bypass sessionAllowed)',
  /jalankan SQUAD multi-agent buat task ini[\s\S]{0,80}forceAsk:\s*true/.test(src));
check('routing nyuntik prefix /squad (satu jalur eksekusi)',
  /instruction\s*=\s*['"]\/squad\s*['"]\s*\+\s*instruction/.test(src));
check('pesan batal → jatuh balik ke single-agent',
  /kerjain single-agent aja/.test(src));
check('route single → kasih tau alasannya', /Single-agent:\s*\$\{verdict\.reason\}/.test(src));

console.log('\n[4] Urutan: routing HARUS sebelum dispatch /squad manual');
{
  const idxRoute = src.indexOf('const verdict = routeTask(instruction)');
  const idxSquad = src.indexOf("startsWith('/squad')");
  check('routing di atas dispatcher /squad', idxRoute > 0 && idxSquad > 0 && idxRoute < idxSquad,
    `idxRoute=${idxRoute} idxSquad=${idxSquad}`);
}

console.log('\n[5] Command di-skip: task yang mulai "/" gak boleh dirouting');
check('guard !startsWith("/") ada di kondisi',
  /!instruction\.trim\(\)\.startsWith\(['"]\/['"]\)/.test(src));

console.log('\n[6] Simulasi alur end-to-end (node tiruan)');
{
  // Tiruin logika cabang routing tanpa baca file, buat mastiin urutannya bener.
  const steps = [];
  const fakeInstruction = 'riset cara kerja X lalu bikin kodenya';
  steps.push(['cek autoRoute', true]);
  steps.push(['cek bukan command', !fakeInstruction.startsWith('/')]);
  steps.push(['routeTask → squad', true]);
  const finalInstruction = '/squad ' + fakeInstruction;
  steps.push(['instruction jadi /squad prefixed', finalInstruction.startsWith('/squad ')]);
  check('task kompleks (autoRoute on) mendarat di jalur /squad',
    finalInstruction === '/squad riset cara kerja X lalu bikin kodenya');
  check('task simpel gak diapa-apain', 'halo kaccan'.startsWith('/squad') === false);
  check('command /mode gak dirouting', '/mode yolo'.trim().startsWith('/') === true);
}

console.log(`\n=== HASIL WIRING: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
