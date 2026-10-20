// tests/test-routing.mjs — Kontrak auto-routing (single-agent vs squad).
//
// Fokus: heuristik harus KONSERVATIF. Salah-route ke squad itu mahal
// (panggilan LLM ×N), salah-route ke single cuma bikin user ketik /squad.
//
// Yang dites:
//   - positive: task beneran kompleks → squad
//   - negative: task simpel / santai → single (INI YANG PALING PENTING)
//   - kasus jebakan: task simpel yang ada kata "lalu/terus"
//   - shouldAsk dipasang di kasus ragu, bukan di kasus yakin
//
// Written by K-sRouter

import { routeTask, collectSignals, describeRouting } from '../src/routing.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

console.log('\n[1] POSITIVE — harus ke squad');
{
  const cases = [
    'riset cara kerja offline search lalu bikin kodenya',
    'cari tahu cara kerja websocket terus implementasi fitur chat realtime',
    'analisis struktur database lalu bikin migrasinya',
    'research best practice auth then implement the login module',
  ];
  for (const c of cases) {
    const r = routeTask(c);
    check(`squad: "${c.slice(0, 45)}..."`, r.route === 'squad', `dapat ${r.route} (${r.reason})`);
  }
}

console.log('\n[2] POSITIVE — task besar multi-tahap');
{
  const big = 'gue mau bikin fitur baru di project ini, pertama refactor dulu modul auth biar rapi, ' +
    'lalu tambahin endpoint registrasi, terus setelah itu bikin test-nya sekalian update dokumentasi';
  const r = routeTask(big);
  check('project besar multi-tahap → squad', r.route === 'squad', `dapat ${r.route} (${r.reason})`);
}

console.log('\n[3] NEGATIVE — task simpel HARUS single (yang paling penting)');
{
  const cases = [
    'baca src/ui.js terus ringkas',
    'apa itu closure di javascript?',
    'halo kaccan',
    'list isi folder src',
    'jelasin cara kerja promise',
    'fix typo di baris 42',
    'cek versi node sekarang',
    'jalankan npm test',
  ];
  for (const c of cases) {
    const r = routeTask(c);
    check(`single: "${c.slice(0, 40)}"`, r.route === 'single', `dapat ${r.route} (${r.reason})`);
  }
}

console.log('\n[4] JEBAKAN — task simpel yang ada kata urutan');
{
  const cases = [
    'baca file package.json lalu tampilkan versinya',
    'lihat isi src terus ringkas',
    'cek log terus kasih tau error apa',
  ];
  for (const c of cases) {
    const r = routeTask(c);
    check(`single (jebakan): "${c.slice(0, 40)}"`, r.route === 'single', `dapat ${r.route} (${r.reason})`);
  }
}

console.log('\n[5] MEDIUM confidence → shouldAsk true');
{
  // Kata riset sendirian itu ambigu: bisa minta dikerjain, bisa cuma nanya.
  // Yang penting: JANGAN pernah auto-jalan, harus tanya dulu.
  const mid = 'riset soal database vector';
  const r = routeTask(mid);
  check('riset sendirian → squad + WAJIB tanya dulu',
    r.route === 'squad' && r.shouldAsk === true && r.confidence === 'medium',
    `route=${r.route} ask=${r.shouldAsk} conf=${r.confidence}`);

  // Dan "analisis X" sendirian TIDAK boleh ke squad — satu agent cukup.
  const analisis = 'analisis performa query database ini';
  const r1b = routeTask(analisis);
  check('analisis sendirian → single (bukan overkill squad)',
    r1b.route === 'single', `dapat ${r1b.route} (${r1b.reason})`);

  const seq = 'bikin modul baru, terus review hasilnya';
  const r2 = routeTask(seq);
  check('urutan + review → tanya dulu kalau confidence medium',
    r2.shouldAsk === (r2.confidence === 'medium'), `conf=${r2.confidence} ask=${r2.shouldAsk}`);
}

console.log('\n[6] HIGH confidence → shouldAsk false');
{
  const strong = 'riset cara kerja offline search lalu bikin kodenya';
  const r = routeTask(strong);
  check('lintas disiplin + urutan → high, gak perlu tanya',
    r.confidence === 'high' && r.shouldAsk === false, `conf=${r.confidence} ask=${r.shouldAsk}`);
}

console.log('\n[7] Input aneh gak boleh crash');
{
  const weird = ['', null, undefined, '   ', 'lalu', 'terus terus terus'];
  let ok = true;
  for (const w of weird) {
    try {
      const r = routeTask(w);
      if (!['single', 'squad'].includes(r.route)) ok = false;
    } catch (e) { ok = false; console.log('    error:', e.message); }
  }
  check('input kosong/null/ngawur gak crash + route valid', ok);
  check('teks kosong → single', routeTask('').route === 'single');
}

console.log('\n[8] collectSignals + describeRouting');
{
  const s = collectSignals('riset lalu bikin');
  check('deteksi marker urutan', s.sequences.length > 0);
  check('deteksi marker lintas disiplin', s.cross.length > 0);
  check('panjang ketecek', s.length === 'riset lalu bikin'.length);
  const d = describeRouting(routeTask('riset lalu bikin kodenya'));
  check('describeRouting balikin string non-kosong', typeof d === 'string' && d.length > 0);
  check('describeRouting nyebut route', /SQUAD|SINGLE/.test(d));
}

console.log('\n[9] STATISTIK AKURASI di dataset campuran');
{
  // Dataset kecil buat mastiin gak ada regresi kasar.
  const labeled = [
    // [teks, ekspektasi]
    ['riset cara kerja X lalu bikin kodenya', 'squad'],
    ['cari tahu API ini terus implementasi', 'squad'],
    ['analisis kode lama lalu refactor jadi modul baru terus bikin testnya', 'squad'],
    ['halo', 'single'],
    ['apa itu closure?', 'single'],
    ['baca file X lalu ringkas', 'single'],
    ['list folder src', 'single'],
    ['fix typo', 'single'],
    ['jelasin cara kerja promise', 'single'],
    ['cek versi node', 'single'],
  ];
  let benar = 0;
  for (const [text, want] of labeled) {
    const got = routeTask(text).route;
    if (got === want) benar++;
    else console.log(`    ✗ "${text}" → mau ${want}, dapat ${got}`);
  }
  const akurasi = Math.round((benar / labeled.length) * 100);
  check(`akurasi dataset ${akurasi}% (${benar}/${labeled.length})`, akurasi >= 90);

  // False-positive ke squad lebih berbahaya daripada false-negative.
  const negatif = labeled.filter(([, w]) => w === 'single');
  let fp = 0;
  for (const [text] of negatif) if (routeTask(text).route === 'squad') fp++;
  check(`false-positive ke squad = 0 dari ${negatif.length} task simpel`, fp === 0, `dapat ${fp}`);
}

console.log(`\n=== HASIL ROUTING: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
