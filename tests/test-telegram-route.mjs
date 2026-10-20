// tests/test-telegram-route.mjs — Kontrak /route + auto-routing di bot Telegram.
//
// Kenapa dipisah dari test-telegram.mjs: file ini fokus ke fitur yang baru
// nyusul (parity REPL → Telegram). Dan dia ngetes JALUR NYATA — handleMessage
// yang sama kayak pesan Telegram asli masuk, bukan cuma regex baca file.
//
// Bug yang ketangkep test ini (pelajaran dari sesi lalu, jangan diulang):
//   - veredict.reasons  → field-nya `reason` (singular). Salah nama = crash
//     di jalur squad, tapi /route test tetap "kelihatan jalan".
//   - describeRouting(verdict) → nerima OBJEK, bukan string.
//   - executePlan(p, ctx, deps) → approval lewat ctx.askApproval, BUKAN
//     opsi ketiga bernama onApproval.
//
// Written by K-sRouter

import { createTelegramBot } from '../src/telegram-bot.js';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

/** Bot palsu: catat semua balasan, hitung jalur mana yang kepanggil. */
function mkBot(over = {}) {
  const sent = [];
  const counts = { squad: 0, single: 0, plan: 0 };
  const bot = createTelegramBot({
    botToken: 'TEST', allowedUserIds: [], approvalTimeoutMs: 400,
    fetchFn: async (url, opt) => {
      sent.push(JSON.parse(opt.body).text);
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    },
    createThread: () => 99, logStep: () => {}, getConversation: () => [],
    discoverTools: async () => [], loadAgentMd: () => '', isDangerous: () => false,
    listAgents: () => [], getActiveAgent: () => null, setActiveAgent: () => null,
    classifyIntent: async () => 'task',
    plan: async () => { counts.plan++; return { ok: true, tasks: [{ id: 1, role: 'researcher' }, { id: 2, role: 'coder' }] }; },
    executePlan: async () => { counts.squad++; return { finalSummary: 'SQUAD SELESAI' }; },
    runInstruction: async () => { counts.single++; return 'SINGLE SELESAI'; },
    ...over,
  });
  return { bot, sent, counts };
}

const msg = (text) => ({ chat: { id: 1 }, from: { id: '42' }, text });
const last = (sent) => String(sent[sent.length - 1] || '');

(async () => {
  // ── [1] /route status & kontrol ──
  console.log('\n[1] /route — status & kontrol');
  {
    const { bot, sent } = mkBot();
    await bot.handleMessage(msg('/route'));
    check('/route tanpa arg → tampil status', /Auto-routing: (ON|OFF)/.test(last(sent)), last(sent).slice(0, 60));
    check('status default = OFF', /Auto-routing: OFF/.test(last(sent)), last(sent).slice(0, 40));
    check('ada petunjuk kontrol', last(sent).includes('/route on'));

    sent.length = 0;
    await bot.handleMessage(msg('/route on'));
    check('/route on → konfirmasi ON', last(sent).includes('ON'), last(sent).slice(0, 60));

    sent.length = 0;
    await bot.handleMessage(msg('/route'));
    check('setelah on → status ON', /Auto-routing: ON/.test(last(sent)), last(sent).slice(0, 40));

    sent.length = 0;
    await bot.handleMessage(msg('/route off'));
    check('/route off → konfirmasi OFF', last(sent).includes('OFF'));
  }

  // ── [2] /route test pakai routing ASLI (regresi field `reason`) ──
  console.log('\n[2] /route test — pakai routing asli');
  {
    const { bot, sent } = mkBot();
    await bot.handleMessage(msg('/route test riset cara kerja X lalu bikin kodenya'));
    const out = last(sent);
    check('gak error', !/Terjadi error/.test(out), out.slice(0, 100));
    check('keluar verdict SQUAD', out.includes('SQUAD'), out.slice(0, 80));
    check('ada alasan (field reason kepakai)', out.includes('—') && out.length > 20, out.slice(0, 100));
    check('LINTAS DISIPLIN terdeteksi', /disiplin|urutan/i.test(out), out.slice(0, 90));

    sent.length = 0;
    await bot.handleMessage(msg('/route test baca src/ui.js terus ringkas'));
    check('task simpel → SINGLE', last(sent).includes('SINGLE'), last(sent).slice(0, 80));
  }

  // ── [3] /route test tanpa task ──
  console.log('\n[3] /route test — input kurang');
  {
    const { bot, sent } = mkBot();
    await bot.handleMessage(msg('/route test'));
    check('kasih contoh pemakaian', /Pakai: \/route test/.test(last(sent)), last(sent).slice(0, 70));
    sent.length = 0;
    await bot.handleMessage(msg('/route blabla'));
    check('sub-perintah ngaco → ditolak sopan', /gak dikenal/.test(last(sent)) && last(sent).includes('on | off'), last(sent).slice(0, 80));
  }

  // ── [4] auto-routing: default OFF ──
  console.log('\n[4] auto-routing — default OFF gak boleh nyentuh squad');
  {
    const { bot, counts, sent } = mkBot();
    await bot.handleMessage(msg('riset cara kerja debounce lalu bikin implementasinya'));
    check('task kompleks TAPI off → jalur single', counts.single === 1 && counts.squad === 0,
      `single=${counts.single} squad=${counts.squad}`);
    check('gak ada pesan auto-route', !sent.some(s => String(s).includes('Auto-route')));
  }

  // ── [5] auto-routing ON: task kompleks masuk squad ──
  console.log('\n[5] auto-routing ON — task kompleks → squad');
  {
    const { bot, counts, sent } = mkBot();
    await bot.handleMessage(msg('/route on'));
    sent.length = 0;
    await bot.handleMessage(msg('riset cara kerja debounce lalu bikin implementasinya'));
    // Sejak M22 auto-route TIDAK langsung mengeksekusi: dia menyusun rencana
    // dulu lalu menunggu /approve. Menembak squad otonom tanpa review itu
    // persis yang bikin satu typo berujung eksekusi yang gak dimau.
    // counts.squad = executePlan (eksekusi). Saat preview dia memang 0 —
    // yang jalan baru penyusunan rencana (counts.plan).
    check('jalur squad menyusun rencana', counts.plan === 1, `plan=${counts.plan}`);
    check('eksekusi BELUM jalan sebelum /approve', counts.squad === 0, `squad=${counts.squad}`);
    check('jalur single TIDAK kepanggil', counts.single === 0, `single=${counts.single}`);
    check('ada pemberitahuan auto-route', sent.some(s => String(s).includes('Auto-route')), sent.join(' | ').slice(0, 100));
    check('auto-route menampilkan preview rencana', sent.some(s => String(s).includes('BELUM dieksekusi')), sent.join(' | ').slice(0, 140));
    check('auto-route BELUM eksekusi sebelum /approve', !sent.some(s => String(s).includes('SQUAD SELESAI')), '');
    check('tidak ada pesan error', !sent.some(s => String(s).includes('Terjadi error')), sent.join(' | ').slice(0, 120));
  }

  // ── [5b] auto-route → preview → /approve → eksekusi ──
  console.log('\n[5b] auto-route + /approve baru eksekusi');
  {
    const { bot, counts, sent } = mkBot();
    await bot.handleMessage(msg('/route on'));
    await bot.handleMessage(msg('riset cara kerja debounce lalu bikin implementasinya'));
    sent.length = 0;
    counts.squad = 0;
    await bot.handleMessage(msg('/approve'));
    check('/approve setelah auto-route → squad jalan', counts.squad === 1, `squad=${counts.squad}`);
    check('/approve mengirim ringkasan akhir', sent.some(s => String(s).includes('SQUAD SELESAI')), '');
  }

  // ── [6] auto-routing ON: task simpel tetap single ──
  console.log('\n[6] auto-routing ON — task simpel tetap single');
  {
    const { bot, counts } = mkBot();
    await bot.handleMessage(msg('/route on'));
    await bot.handleMessage(msg('baca src/ui.js terus ringkas'));
    check('jalur single kepanggil', counts.single === 1, `single=${counts.single}`);
    check('jalur squad TIDAK kepanggil', counts.squad === 0, `squad=${counts.squad}`);
  }

  // ── [7] auto-routing ON: yang RAGU harus tanya, bukan langsung jalan ──
  console.log('\n[7] auto-routing ON — ragu harus tanya dulu');
  {
    const { bot, counts, sent } = mkBot();
    await bot.handleMessage(msg('/route on'));
    sent.length = 0;
    // "riset soal database vector" → squad tapi confidence medium (shouldAsk):
    // ada kata riset, tapi gak ada sinyal lintas disiplin + urutan.
    await bot.handleMessage(msg('riset soal database vector'));
    const tanya = sent.some(s => String(s).includes('gak yakin'));
    check('minta konfirmasi dulu', tanya, sent.join(' | ').slice(0, 120));
    check('tidak langsung ngejalanin squad', counts.squad === 0, `squad=${counts.squad}`);
    check('disaranin pakai /squad manual', sent.some(s => String(s).includes('/squad ')), 'gak ada saran manual');
  }

  // ── [7b] task biasa tanpa sinyal → single, gak usah nanya ──
  console.log('\n[7b] auto-routing ON — tanpa sinyal = single, tanpa nanya');
  {
    const { bot, counts, sent } = mkBot();
    await bot.handleMessage(msg('/route on'));
    sent.length = 0;
    await bot.handleMessage(msg('cari tau soal database vector'));
    check('gak ada pertanyaan balik', !sent.some(s => String(s).includes('gak yakin')), sent.join(' | ').slice(0, 90));
    check('langsung jalur single', counts.single === 1, `single=${counts.single}`);
  }

  // ── [8] auto-routing OFF lagi → balik single ──
  console.log('\n[8] auto-routing bisa dimatiin lagi');
  {
    const { bot, counts } = mkBot();
    await bot.handleMessage(msg('/route on'));
    await bot.handleMessage(msg('/route off'));
    await bot.handleMessage(msg('riset cara kerja debounce lalu bikin implementasinya'));
    check('setelah off → balik jalur single', counts.single === 1 && counts.squad === 0,
      `single=${counts.single} squad=${counts.squad}`);
  }

  // ── [9] intent casual gak boleh di-route sama sekali ──
  console.log('\n[9] intent casual → langsung balas, gak masuk routing');
  {
    const { bot, counts, sent } = mkBot({
      classifyIntent: async () => 'casual',
      runCasual: async () => 'BALASAN SANTAI',
    });
    await bot.handleMessage(msg('/route on'));
    sent.length = 0;
    await bot.handleMessage(msg('riset cara kerja debounce lalu bikin implementasinya'));
    check('balasan casual dipakai', sent.some(s => String(s).includes('BALASAN SANTAI')));
    check('squad & single dua-duanya dilewati', counts.squad === 0 && counts.single === 0,
      `squad=${counts.squad} single=${counts.single}`);
  }

  // ── [10] /help nyebut /route ──
  console.log('\n[10] /help nyebut /route & /mode');
  {
    const { bot, sent } = mkBot();
    await bot.handleMessage(msg('/help'));
    const h = last(sent);
    check('help memuat /route', h.includes('/route'), h.slice(0, 80));
    check('help memuat /route test', h.includes('/route test'));
    check('help memuat /mode', h.includes('/mode'));
  }

  console.log(`\n=== HASIL TELEGRAM-ROUTE: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
