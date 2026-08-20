import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { askWithFallback, fallbackState } from './lib/providers.js';
import { planStep } from './lib/plan.js';
import { showDiff } from './lib/diff.js';
import { runCommand } from './lib/bash.js';
import { logStep, saveDecision, getRecentDecisions, saveSnapshot, getLatestSnapshot, listSnapshots } from './lib/db.js';

const MAX_LOOPS = 10;
const sessionAllowed = new Set();

const ALWAYS_ASK_PATTERNS = [
  /\brm\b/, /\bsudo\b/, /\bchmod\b/, /\bdd\b/,
  /\bnpm\s+uninstall\b/, /\bpkg\s+uninstall\b/, /\bkill\b/
];

function isDangerous(command) {
  return ALWAYS_ASK_PATTERNS.some(p => p.test(command));
}

// Satu rl untuk seluruh sesi — biar gak konflik kalau dibuat ulang di tiap prompt
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function readFileSafe(target) {
  if (!target || !fs.existsSync(target)) return '(file belum ada / belum ditentukan)';
  return fs.readFileSync(target, 'utf8');
}

function listDirSafe(target) {
  const dir = (target || '.').trim();
  if (!fs.existsSync(dir)) return `(direktori '${dir}' tidak ditemukan)`;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.length === 0) return '(kosong)';
    return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
  } catch (err) {
    return `(error baca direktori: ${err.message})`;
  }
}

function loadAgentMd() {
  const path = './AGENT.md';
  if (!fs.existsSync(path)) return null;
  return fs.readFileSync(path, 'utf8');
   }

async function askApproval(label, { forceAsk = false } = {}) {
  if (!forceAsk && sessionAllowed.has(label)) {
    console.log(`[AUTO] ${label} diizinkan untuk sesi ini.`);
    return { approved: true, condition: null };
  }

  if (forceAsk) {
    console.log('[⚠️ PERINGATAN] Command destruktif — "allow for session" tidak tersedia.');
  }

  console.log('1) Allow once');
  if (!forceAsk) console.log('2) Allow for this session');
  console.log('3) Do not approve');
  console.log('4) Approve with condition');

  const choice = (await ask('> ')).trim();

  if (choice === '1') return { approved: true, condition: null };

  if (choice === '2') {
    if (forceAsk) {
      console.log('[Tidak tersedia untuk command destruktif.]');
      return { approved: false, condition: null };
    }
    sessionAllowed.add(label);
    console.log(`[SESSION] ${label} akan auto-approved sampai /exit.`);
    return { approved: true, condition: null };
  }

  if (choice === '3') return { approved: false, condition: null };

  if (choice === '4') {
    const condition = await ask('Ketik kondisi: ');
    console.log(`\nKondisi yang akan diteruskan ke agent: "${condition.trim()}"`);
    const confirm = await ask('Lanjut? (y/n): ');
    if (confirm.trim().toLowerCase() !== 'y') return { approved: false, condition: null };
    return { approved: true, condition: condition.trim() };
  }

  console.log('[Input tidak valid, default: tidak diapprove]');
  return { approved: false, condition: null };
 }

async function runTask(instruction, agentMd) {
  const history = [];
  let lastTarget = null;
  const recentMemory = getRecentDecisions(5);

  for (let i = 1; i <= MAX_LOOPS; i++) {
    console.log(`\n=== Langkah ${i}/${MAX_LOOPS} ===`);
    const fileSnapshot = readFileSafe(lastTarget);
    const step = await planStep(askWithFallback, { instruction, fileSnapshot, history, agentMd, recentMemory });
    console.log(`[PROVIDER] ${fallbackState.lastProvider}`);
    console.log(`[REASONING] ${step.reasoning}`);

    // --- DONE ---
    if (step.action === 'done') {
      console.log(`[SELESAI] ${step.summary}`);
      logStep({ task: instruction, actionType: 'done', detail: null, reasoning: step.reasoning, approved: true });
      return;
    }

    // --- READ ---
    if (step.action === 'read') {
      const content = readFileSafe(step.target);
      // Truncate biar gak bloat context window — 2000 char cukup buat kebanyakan file
      const preview = content.length > 2000
        ? content.slice(0, 2000) + '\n[...TRUNCATED — file masih ada isinya tapi dipotong di sini]'
        : content;
      console.log(`[READ] ${step.target}`);
      console.log(`--- ISI FILE ---`);
      console.log(preview);
      console.log(`--- END ---`);
      history.push({ action: 'read', target: step.target, content: preview });
      continue;
    }

    // --- LIST_DIR ---
    if (step.action === 'list_dir') {
      const listing = listDirSafe(step.target);
      const dir = (step.target || '.').trim();
      console.log(`[LIST_DIR] ${dir}\n${listing}`);
      history.push({ action: 'list_dir', target: dir, listing });
      continue;
    }

   // --- REMEMBER ---
   if (step.action === 'remember') {
      saveDecision({ key: step.key, value: step.value, context: instruction });
      console.log(`[REMEMBER] ${step.key}: ${step.value}`);
      history.push({ action: 'remember', key: step.key, value: step.value });
      continue;
    }
    
    // --- EDIT ---
    if (step.action === 'edit') {
      const current = readFileSafe(step.target);
      console.log(`\n--- DIFF: ${step.target} ---`);
      console.log(showDiff(current === '(file belum ada / belum ditentukan)' ? '' : current, step.new_content));
      console.log(`--- END DIFF ---`);
      const editApproval = await askApproval('edit');
      logStep({ task: instruction, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });
    if (!editApproval.approved) {
      console.log('[DITOLAK] Langkah dibatalkan, task dihentikan.');
      return;
    }
    if (editApproval.condition) {
      history.push({ action: 'user_condition', condition: editApproval.condition });        
    }
    
   const existingContent = readFileSafe(step.target);
    if (existingContent !== '(file belum ada / belum ditentukan)') {
      saveSnapshot({ filepath: step.target, content: existingContent });
      console.log(`[SNAPSHOTS] ${step.target} disimpan.`);
    }
  
      fs.writeFileSync(step.target, step.new_content, 'utf8');
      console.log(`[WRITE] ${step.target} diupdate.`);
      lastTarget = step.target;
      history.push({ action: 'edit', target: step.target, approved: true });
      continue;
    }

    // --- BASH ---
    if (step.action === 'bash') {
      console.log(`\n[COMMAND] ${step.command}`);
      const dangerous = isDangerous(step.command);
      const bashApproval = await askApproval('bash', { forceAsk: dangerous });
    if (!bashApproval.approved) {
      logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
      console.log('[DITOLAK] Command dibatalkan, task dihentikan.');
      return;
     }
    if (bashApproval.condition) {
       history.push({ action: 'user_condition', condition: bashApproval.condition });
     }
       const result = await runCommand(step.command);
       console.log(`[EXIT ${result.code}] stdout: ${result.stdout || '(kosong)'}`);
    if (result.stderr) console.log(`[STDERR] ${result.stderr}`);
      logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      history.push({ action: 'bash', command: step.command, approved: true, result });
      continue;
    }
  }

  console.log(`\n[BERHENTI] Sampai batas ${MAX_LOOPS} langkah tanpa selesai.`);
}

async function chat() {
  console.log('K-sRouter-CLI — ketik instruksi, /exit untuk keluar.\n');
  
  const agentMd = loadAgentMd();
  if (agentMd) console.log('[AGENT.md] Project instructions loaded.\n');
  
  while (true) {
    const input = await ask('> ');
    const instruction = input.trim();

    if (!instruction) continue;

    if (instruction.toLowerCase() === '/exit') {
      console.log('Bye.');
      rl.close();
      process.exit(0);
    }

    if (instruction.toLowerCase().startsWith('/rollback')) {
      const filepath = instruction.split('')[1];
      
    if(!filepath) {
      const snaps = listSnapshots();
    if(snaps.length === 0) {
      console.log(`Belum ada snapshots tersimpan.`);
    }
    else {
      console.log('File yang punya snapshot:');
      snaps.forEach(s => console.log(` ${s.filepath} - ${s.versions} versi, terakhir: ${s.last_snapshot}`));
    }
    continue;
    }
    
    const snap = getLatestSnapshot(filepath);
    if (!snap) {
      console.log(`[ROLLBACK] Tidak ada snapshot untuk ${filepath}.`);
    }
    
    const current = readFileSafe(filepath);
     console.log(`\n--- DIFF: ${filepath} (current → snapshot ${snap.created_at} ---`);
     console.log(showDiff(current === '(file belum ada / belum ditentukan)' ? '' : current, snap.content));
     console.log(`--- END DIFF ---`);
     
    const confirm = await ask('Rollback ke snapshot ini? (y/n): ');
    if (confirm.trim().toLowerCase() === 'y') { 
      fs.writeFileSync(filepath, snap.content, 'utf8');
      console.log(`[ROLLBACK] ${filepath} dikembalikan ke snapshot ${snap.created_at}.`);
    } else {
      console.log(`[ROLLBACK] goblok, gw batalkan.`);
    }
    continue;
    }

    await runTask(instruction, agentMd);
  }
}

chat().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});

