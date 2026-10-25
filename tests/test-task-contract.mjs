// M47 RED: ekstraksi goal, constraint, dan acceptance criteria dari instruksi user.
// Semua deterministik — tidak boleh butuh LLM, tidak boleh butuh network.
import {
  extractGoal, extractConstraints, deriveAcceptanceCriteria, buildTaskContract,
  contractBlocksCompletion, renderContract,
} from '../src/task-contract.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

// ── [1] Goal extraction ─────────────────────────────────────────────────────
check('goal: instruksi kosong -> string kosong',
  extractGoal('') === '');
check('goal: instruksi satu baris dipertahankan',
  extractGoal('Bikin endpoint login').includes('login'));
check('goal: instruksi multi-baris diambil inti pertama yang bukan basa-basi',
  !/^(halo|hai|woi)\b/i.test(extractGoal('halo\nTolong bikin endpoint login yang aman')));
check('goal: dibatasi panjang maksimum',
  extractGoal('x'.repeat(2000)).length <= 400);

// ── [2] Constraint extraction ───────────────────────────────────────────────
{
  const c = extractConstraints('Rapihin auth tapi jangan ubah API publik dan jangan hapus test');
  check('constraint: menangkap "jangan ubah API publik"',
    c.some(x => /api publik/i.test(x.text)));
  check('constraint: menangkap "jangan hapus test"',
    c.some(x => /hapus test/i.test(x.text)));
  check('constraint: ditandai jenis prohibition',
    c.every(x => x.kind === 'prohibition'));
}
{
  const c = extractConstraints('Bikin report, wajib pakai TypeScript, maksimal 3 file');
  check('constraint: menangkap requirement "wajib"',
    c.some(x => /typescript/i.test(x.text) && x.kind === 'requirement'));
  check('constraint: menangkap batas "maksimal 3 file"',
    c.some(x => /maksimal 3 file/i.test(x.text) && x.kind === 'limit'));
}
check('constraint: instruksi tanpa constraint -> array kosong',
  extractConstraints('Bikin file hello.txt berisi halo').length === 0);
check('constraint: tidak menangkap kalimat biasa sebagai constraint',
  !extractConstraints('Tolong jelaskan cara kerja HTTP').length);

// ── [3] Acceptance criteria ─────────────────────────────────────────────────
{
  const ac = deriveAcceptanceCriteria({ instruction: 'Bikin file src/app.js lalu jalankan test', constraints: [] });
  check('ac: selalu ada kriteria minimal (bukti kerja nyata)',
    Array.isArray(ac) && ac.length >= 1);
  check('ac: setiap kriteria punya id dan text',
    ac.every(a => a.id && a.text));
  check('ac: instruksi menyebut test -> ada kriteria menjalankan test',
    ac.some(a => /test/i.test(a.text)));
  check('ac: instruksi menyebut file -> ada kriteria file aktual terverifikasi',
    ac.some(a => /file|berkas/i.test(a.text)));
}
{
  const ac = deriveAcceptanceCriteria({
    instruction: 'Rapihin auth tapi jangan ubah API publik',
    constraints: extractConstraints('Rapihin auth tapi jangan ubah API publik'),
  });
  check('ac: constraint prohibition jadi kriteria kepatuhan',
    ac.some(a => /jangan ubah api publik/i.test(a.text) && a.source === 'constraint'));
}
{
  const ac = deriveAcceptanceCriteria({ instruction: 'x'.repeat(5), constraints: [] });
  check('ac: instruksi minimal tetap menghasilkan kriteria dasar',
    ac.length >= 1);
}

// ── [4] Task contract ───────────────────────────────────────────────────────
{
  const c = buildTaskContract('Bikin endpoint login dan jalankan test, jangan ubah config');
  check('contract: punya goal', typeof c.goal === 'string' && c.goal.length > 0);
  check('contract: punya constraints array', Array.isArray(c.constraints));
  check('contract: punya acceptance array', Array.isArray(c.acceptance) && c.acceptance.length > 0);
  check('contract: semua acceptance id unik',
    new Set(c.acceptance.map(a => a.id)).size === c.acceptance.length);
  check('contract: punya risk level valid',
    ['low', 'medium', 'high'].includes(c.risk));
  check('contract: instruksi destruktif -> risk tinggi',
    buildTaskContract('hapus semua file di src dan format disk').risk === 'high');
  check('contract: instruksi biasa -> risk rendah/sedang',
    ['low', 'medium'].includes(buildTaskContract('baca isi package.json').risk));
}
{
  const c = buildTaskContract('Bikin file a.js');
  const c2 = buildTaskContract('Bikin file a.js');
  check('contract: deterministik (instruksi sama -> id kriteria sama)',
    JSON.stringify(c.acceptance.map(a => a.id)) === JSON.stringify(c2.acceptance.map(a => a.id)));
}
// REGRESI: larangan tidak boleh menaikkan risk. "jangan hapus test" itu permintaan
// agar TIDAK menghapus, jadi tidak boleh bikin task dinilai high risk.
{
  const risiko = buildTaskContract('Rapihin auth tapi jangan ubah API publik dan jangan hapus test').risk;
  check('REGRESI risk: larangan "jangan hapus" tidak bikin risk high',
    risiko !== 'high');
}
{
  const risiko = buildTaskContract('Tolong bersihin kode, tanpa hapus test').risk;
  check('REGRESI risk: "tanpa hapus" juga tidak bikin high',
    risiko !== 'high');
}
// Batas kuantitatif wajib punya kriteria pengukuran.
{
  const contract = buildTaskContract('Bikin report, maksimal 3 file');
  check('REGRESI limit: "maksimal 3 file" menghasilkan kriteria pengukuran',
    contract.acceptance.some(a => a.source === 'measurement'));
}
{
  const c = buildTaskContract('Bikin endpoint dan jalankan test');
  check('contract: tidak menyimpan secret walau instruksi menyebut kata sensitif',
    !JSON.stringify(c).includes('sk-'));
}

// ── [5] Completion gate ─────────────────────────────────────────────────────
{
  const contract = buildTaskContract('Bikin endpoint login dan jalankan test');
  const oneItem = { id: contract.acceptance[0].id, status: 'completed' };
  check('gate: menolak selesai kalau kriteria belum semua dibuktikan',
    contractBlocksCompletion(contract, [oneItem]).blocked === true);
}
{
  const contract = buildTaskContract('Bikin endpoint login dan jalankan test');
  const all = contract.acceptance.map(a => ({ id: a.id, status: 'completed', evidence: 'ok' }));
  check('gate: mengizinkan selesai kalau semua kriteria punya bukti',
    contractBlocksCompletion(contract, all).blocked === false);
}
{
  const contract = buildTaskContract('Bikin endpoint login dan jalankan test');
  const noEvidence = contract.acceptance.map(a => ({ id: a.id, status: 'completed' }));
  check('gate: status completed tanpa evidence tetap ditolak',
    contractBlocksCompletion(contract, noEvidence).blocked === true);
}
{
  const contract = buildTaskContract('Bikin endpoint login');
  check('gate: contract kosong/null tidak memblokir selamanya',
    contractBlocksCompletion(null, []).blocked === false);
}
{
  const contract = buildTaskContract('Bikin endpoint login dan jalankan test');
  const partial = contract.acceptance.map((a, i) =>
    i === 0 ? { id: a.id, status: 'completed', evidence: 'ok' } : { id: a.id, status: 'pending' });
  const res = contractBlocksCompletion(contract, partial);
  check('gate: alasan menyebut kriteria yang masih pending',
    res.blocked === true && res.reason && res.reason.length > 0);
}

// ── [6] Render ──────────────────────────────────────────────────────────────
{
  const contract = buildTaskContract('Bikin endpoint login dan jalankan test');
  const text = renderContract(contract);
  check('render: menampilkan goal', text.includes(contract.goal));
  check('render: menampilkan acceptance criteria',
    contract.acceptance.every(a => text.includes(a.text)));
  check('render: tidak pernah kosong', text.trim().length > 0);
}
{
  const text = renderContract(null);
  check('render: contract null tidak crash', typeof text === 'string');
}

// REGRESI M47: scaffolding internal KIANNNNN tidak boleh jadi constraint user.
// Worker squad dulu diblokir oleh kalimat brief-nya sendiri.
{
  const brief = 'Konteks task besar dari user: bikin API login\n\nTugasmu (role researcher): riset cara login aman\n\nKerjakan TUGASMU SAJA sesuai brief di atas. Jangan kerjakan bagian lain.';
  const c = extractConstraints(brief);
  check('REGRESI scaffolding: "Jangan kerjakan bagian lain" bukan constraint user',
    !c.some(x => /kerjakan bagian lain/i.test(x.text)));
  check('REGRESI scaffolding: brief worker tidak menghasilkan constraint palsu',
    c.length === 0, JSON.stringify(c));
  check('REGRESI scaffolding: risk brief worker rendah',
    buildTaskContract(brief).risk === 'low');
}

console.log(`\n=== HASIL TASK-CONTRACT: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
