// tests/test-telegram.mjs — M17: routing, approval via balasan chat,
// allowlist, dan squad wiring — SEMUA offline (fetch & LLM di-mock).
// Written by K'

const { createTelegramBot, isApprovalAnswer } = await import('../src/telegram-bot.js');

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── mock Telegram API: semua sendMessage dicatat, getUpdates selalu kosong ──
const sent = [];
const fetchFn = async (url, opts) => {
  if (opts && opts.body) sent.push(JSON.parse(opts.body).text);
  return { json: async () => ({ ok: true, result: [] }) };
};

// ── mock dependency LLM/orchestrator ──
let planCalled = null, execCalled = null, instrArgs = null, activeSet = undefined, approvalTrigger = false;
const fakePlan = async (task) => {
  planCalled = task;
  return { ok: true, tasks: [{ id: 1, role: 'coder', brief: 'Implementasikan fitur login di src/login.js', dependsOn: null }],
           problems: [], attempts: 1, raw: '' };
};
const fakeExec = async (p, ctx) => {
  execCalled = { p, ctx };
  return { ok: true, fallback: false, problems: [],
           results: [{ id: 1, role: 'coder', summary: 'kode jadi' }],
           finalSummary: 'SQUAD SELESAI: kode jadi' };
};
const fakeRunInstr = async (...args) => {
  instrArgs = args;
  if (approvalTrigger) {
    // simulasi agent yang minta izin edit di tengah task
    const r = await args[8]('edit');
    return `APPROVED=${r.approved}`;
  }
  return 'SINGLE OK';
};

const bot = createTelegramBot({
  botToken: 'TEST_TOKEN', allowedUserIds: ['42'], fetchFn, approvalTimeoutMs: 800,
  createThread: () => 99, logStep: () => {}, getConversation: () => [],
  runInstruction: fakeRunInstr,
  getActiveAgent: () => null,
  setActiveAgent: (n) => { activeSet = n; return { name: n, description: 'desc', actions: ['read', 'bash'] }; },
  listAgents: () => [{ name: 'coder', description: 'x' }, { name: 'researcher', description: 'y' }, { name: 'reviewer', description: 'z' }],
  plan: fakePlan, executePlan: fakeExec,
  runCasual: async () => 'CASUAL OK',
  classifyIntent: async () => 'task',
  discoverTools: async () => [], loadAgentMd: () => 'MD',
  isDangerous: () => false,
});

const msg = (text, userId = '42') => ({ chat: { id: 1 }, from: { id: userId }, text });
const lastSent = () => sent[sent.length - 1] || '';

// ── [1] isApprovalAnswer ──
console.log('\n[1] isApprovalAnswer');
check('y = jawaban', isApprovalAnswer('y'));
check('N besar-case = jawaban', isApprovalAnswer('N'));
check('c <kondisi> = jawaban', isApprovalAnswer('c jangan hapus node_modules'));
check('s = jawaban', isApprovalAnswer('s'));
check('instruksi biasa BUKAN jawaban', !isApprovalAnswer('/plan riset X'));
check('kalimat bebas BUKAN jawaban', !isApprovalAnswer('tolong kerjakan dulu'));

// ── [2] routing command ──
console.log('\n[2] command routing');
sent.length = 0;
await bot.handleMessage(msg('/help'));
check('/help balas daftar perintah', lastSent().includes('perintah'));

sent.length = 0;
await bot.handleMessage(msg('/agent'));
check('/agent tanpa arg: mode generic', lastSent().includes('generic'));

sent.length = 0;
await bot.handleMessage(msg('/agent coder'));
check('/agent coder aktifkan agent', lastSent().includes('coder') && activeSet === 'coder');

sent.length = 0;
await bot.handleMessage(msg('/plan bikin fitur login'));
check('/plan memanggil plan() dgn teks task', planCalled === 'bikin fitur login');
check('/plan balas ringkasan rencana', lastSent().includes('Rencana'));

sent.length = 0;
execCalled = null;
// Sejak M22: /squad TIDAK langsung jalan. Dia tampilkan rencana lalu nunggu
// /approve. Ini gerbang review — user harus liat rencananya dulu.
await bot.handleMessage(msg('/squad riset X lalu bikin kodenya'));
check('/squad menampilkan rencana, BELUM eksekusi', execCalled === null);
check('/squad balas preview rencana', lastSent().includes('Rencana squad') && lastSent().includes('BELUM dieksekusi'));
check('/squad nyuruh /approve atau /cancel', lastSent().includes('/approve'));

// Baru setelah /approve, eksekusi jalan.
sent.length = 0;
await bot.handleMessage(msg('/approve'));
check('/approve → executePlan kepanggil', execCalled !== null);
check('/approve balas ringkasan squad', sent.some(s => s.includes('SQUAD SELESAI')));

// /approve dua kali harus DITOLAK (rencana sekali pakai).
sent.length = 0;
execCalled = null;
await bot.handleMessage(msg('/approve'));
check('/approve dua kali tidak mengeksekusi ulang', execCalled === null);

sent.length = 0;
await bot.handleMessage(msg('/stats'));
check('/stats balas statistik', lastSent().includes('LLM call'));

// ── [3] allowlist ──
console.log('\n[3] allowlist');
sent.length = 0;
await bot.handleMessage(msg('/help', '999'));
check('user di luar allowlist DIBUNGKAM', sent.length === 0);

// ── [4] task biasa lewat runInstruction (orchestrator) ──
console.log('\n[4] task biasa → runInstruction');
sent.length = 0; instrArgs = null;
await bot.handleMessage(msg('buatkan fungsi util'));
check('classifyIntent=task → runInstruction dipakai', instrArgs !== null && lastSent() === 'SINGLE OK');
check('argumen lengkap: threadId=99', instrArgs[3] === 99);
check('argumen: agentMd=MD', instrArgs[1] === 'MD');
check('argumen terakhir: askApproval fungsi', typeof instrArgs[8] === 'function');

// ── [5] approval via balasan chat ──
console.log('\n[5] approval via balasan chat (y/s/n/c)');
sent.length = 0;
approvalTrigger = true;
// task yang di dalamnya minta approval edit
const pendingP = bot.handleMessage(msg('edit file konfigurasi'));
for (let i = 0; i < 100 && !sent.some(s => s.includes('IZIN')); i++) await sleep(10);
check('pertanyaan izin terkirim', sent.some(s => s.includes('IZIN: edit')));

// balasan yang bukan jawaban → reminder, approval TETAP nunggu
sent.length = 0;
await bot.handleMessage(msg('eh iya dulu deh'));
check('balasan asing → reminder izin nunggu', lastSent().includes('menunggu'));

// balasan 'y' → resolve
await bot.handleMessage(msg('y'));
await pendingP;
approvalTrigger = false;
check('y → approved=true diteruskan ke runInstruction', lastSent() === 'APPROVED=true', lastSent());

// ── [6] approval ditolak (n) ──
console.log('\n[6] approval ditolak');
sent.length = 0;
approvalTrigger = true;
const pending6 = bot.handleMessage(msg('edit file kedua'));
for (let i = 0; i < 100 && !sent.some(s => s.includes('IZIN')); i++) await sleep(10);
await bot.handleMessage(msg('n'));
await pending6;
approvalTrigger = false;
check('n → approved=false', lastSent() === 'APPROVED=false', lastSent());

// ── [7] busy gate: task kedua saat masih jalan → ditahan ──
console.log('\n[7] busy gate');
{
  let release; const gate = new Promise(r => { release = r; });
  let concurrent = 0, maxConcurrent = 0;
  const slowBot = createTelegramBot({
    botToken: 'T', allowedUserIds: [], fetchFn,
    createThread: () => 1, logStep: () => {}, getConversation: () => [],
    runInstruction: async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await gate; concurrent--; return 'DONE'; },
    getActiveAgent: () => null, setActiveAgent: () => null,
    listAgents: () => [{ name: 'x', description: 'y' }],
    plan: fakePlan, executePlan: fakeExec,
    runCasual: async () => '', classifyIntent: async () => 'task',
    discoverTools: async () => [], loadAgentMd: () => '', isDangerous: () => false,
  });
  sent.length = 0;
  const p1 = slowBot.handleMessage(msg('tugas pertama'));
  await sleep(30);
  await slowBot.handleMessage(msg('tugas kedua — harus ditahan'));
  check('pesan kedua kena gate "tunggu"', lastSent().includes('tunggu'));
  release(); await p1;
  check('gak pernah ada 2 task paralel', maxConcurrent === 1);
}

console.log(`\n=== HASIL M17-telegram: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
