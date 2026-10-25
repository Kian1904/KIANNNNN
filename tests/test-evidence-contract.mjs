// M47: evidenceForContract — bukti harus dari aksi terverifikasi, bukan klaim.
import { evidenceForContract } from '../src/run-task.js';
import { buildTaskContract, contractBlocksCompletion } from '../src/task-contract.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

const allPending = results => results.every(r => r.status === 'pending');

// [1] Tanpa history sama sekali -> semua pending, done harus diblok.
{
  const contract = buildTaskContract('Bikin file src/app.js lalu jalankan test');
  const results = evidenceForContract([], contract);
  check('history kosong -> semua kriteria pending', allPending(results));
  check('history kosong -> gate memblokir done', contractBlocksCompletion(contract, results).blocked === true);
}

// [2] Aksi GAGAL tidak boleh jadi bukti.
{
  const contract = buildTaskContract('Bikin file src/app.js lalu jalankan test');
  const history = [
    { action: 'edit', target: 'src/app.js', verified: false, error: 'syntax error' },
    { action: 'bash', command: 'npm test', verified: false, result: { code: 1 } },
  ];
  const results = evidenceForContract(history, contract);
  check('aksi gagal saja -> tetap pending', allPending(results));
  check('aksi gagal saja -> gate memblokir', contractBlocksCompletion(contract, results).blocked === true);
}

// [3] Klaim tanpa verified tidak dihitung.
{
  const contract = buildTaskContract('Bikin file src/app.js');
  const history = [{ action: 'edit', target: 'src/app.js' }];  // verified undefined
  const results = evidenceForContract(history, contract);
  check('aksi tanpa verified flag tidak jadi bukti', allPending(results));
}

// [4] Aksi terverifikasi memenuhi kriteria yang sesuai.
{
  const contract = buildTaskContract('Bikin file src/app.js lalu jalankan test');
  const history = [
    { action: 'edit', target: 'src/app.js', verified: true },
    { action: 'bash', command: 'npm test', verified: true, result: { code: 0 } },
  ];
  const results = evidenceForContract(history, contract);
  check('edit + test terverifikasi -> gate mengizinkan done',
    contractBlocksCompletion(contract, results).blocked === false);
  check('setiap bukti punya teks evidence',
    results.filter(r => r.status === 'completed').every(r => r.evidence && r.evidence.length > 0));
}

// [5] Task riset butuh bukti web, bukan sekadar edit.
{
  const contract = buildTaskContract('Riset cara kerja HTTP/2 lalu rangkum sumbernya');
  const onlyEdit = evidenceForContract([{ action: 'edit', verified: true }], contract);
  check('task riset: edit saja tidak memenuhi kriteria evidence',
    contractBlocksCompletion(contract, onlyEdit).blocked === true);
  const withWeb = evidenceForContract([{ action: 'web_fetch', verified: true }], contract);
  check('task riset: web_fetch terverifikasi memenuhi',
    contractBlocksCompletion(contract, withWeb).blocked === false);
}

// [6] Constraint dilanggar -> tidak boleh lolos.
{
  const contract = buildTaskContract('Rapihin auth jangan ubah API publik, lalu jalankan test');
  const history = [
    { action: 'edit', verified: true },
    { action: 'bash', verified: true },
    { action: 'bash', verified: false, error: 'constraint dilanggar: API publik berubah' },
  ];
  const results = evidenceForContract(history, contract);
  check('pelanggaran constraint tercatat -> gate tetap memblokir',
    contractBlocksCompletion(contract, results).blocked === true);
}

// [7] Robustness.
{
  check('history null tidak crash', Array.isArray(evidenceForContract(null, null)));
  check('contract null tidak crash', Array.isArray(evidenceForContract([], null)));
  check('history berisi null tidak crash',
    Array.isArray(evidenceForContract([null, undefined, {}], buildTaskContract('x'))));
}

console.log(`\n=== HASIL EVIDENCE-CONTRACT: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
