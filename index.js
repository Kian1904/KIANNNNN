import 'dotenv/config';
import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { askWithFallback, fallbackState } from './lib/providers.js';
import { planStep } from './lib/plan.js';
import { showDiff } from './lib/diff.js';
import { runCommand } from './lib/bash.js';
import { logStep } from './lib/db.js';

const MAX_LOOPS = 10;

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

async function runTask(instruction) {
  const history = [];
  let lastTarget = null;

  for (let i = 1; i <= MAX_LOOPS; i++) {
    console.log(`\n=== Langkah ${i}/${MAX_LOOPS} ===`);
    const fileSnapshot = readFileSafe(lastTarget);
    const step = await planStep(askWithFallback, { instruction, fileSnapshot, history });
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

    // --- EDIT ---
    if (step.action === 'edit') {
      const current = readFileSafe(step.target);
      console.log(`\n--- DIFF: ${step.target} ---`);
      console.log(showDiff(current === '(file belum ada / belum ditentukan)' ? '' : current, step.new_content));
      console.log(`--- END DIFF ---`);
      const answer = await ask('Terapkan? (y/n): ');
      const approved = answer.trim().toLowerCase() === 'y';

      logStep({ task: instruction, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved });

      if (!approved) {
        console.log('[DITOLAK] Langkah dibatalkan, task dihentikan.');
        return;
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
      const answer = await ask('Jalankan command ini? (y/n): ');
      const approved = answer.trim().toLowerCase() === 'y';

      if (!approved) {
        logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        console.log('[DITOLAK] Command dibatalkan, task dihentikan.');
        return;
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

  while (true) {
    const input = await ask('> ');
    const instruction = input.trim();

    if (!instruction) continue;

    if (instruction.toLowerCase() === '/exit') {
      console.log('Bye.');
      rl.close();
      process.exit(0);
    }

    await runTask(instruction);
  }
}

chat().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});

