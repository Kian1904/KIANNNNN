import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { askWithFallback, fallbackState } from './lib/providers.js';
import { planStep } from './lib/plan.js';
import { showDiff } from './lib/diff.js';
import { runCommand } from './lib/bash.js';
import { logStep } from './lib/db.js';

const INSTRUCTION = process.argv[2];
const MAX_LOOPS = 10;

if (!INSTRUCTION) {
  console.error('Pakai: node index.js "<instruksi task>"');
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function readFileSafe(target) {
  if (!target || !fs.existsSync(target)) return '(file belum ada / belum ditentukan)';
  return fs.readFileSync(target, 'utf8');
}

async function main() {
  const history = [];
  let lastTarget = null;

  for (let i = 1; i <= MAX_LOOPS; i++) {
    console.log(`\n=== Langkah ${i}/${MAX_LOOPS} ===`);
    const fileSnapshot = readFileSafe(lastTarget);
    const step = await planStep(askWithFallback, { instruction: INSTRUCTION, fileSnapshot, history });
    console.log(`[PROVIDER] ${fallbackState.lastProvider}`);
    console.log(`[REASONING] ${step.reasoning}`);

    if (step.action === 'done') {
      console.log(`[SELESAI] ${step.summary}`);
      return;
    }

    if (step.action === 'edit') {
      const current = readFileSafe(step.target);
      console.log(`\n--- DIFF: ${step.target} ---`);
      console.log(showDiff(current === '(file belum ada / belum ditentukan)' ? '' : current, step.new_content));
      console.log(`--- END DIFF ---`);
      const answer = await ask('Terapkan? (y/n): ');
      const approved = answer.trim().toLowerCase() === 'y';

      logStep({ task: INSTRUCTION, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved });

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

    if (step.action === 'bash') {
      console.log(`\n[COMMAND] ${step.command}`);
      const answer = await ask('Jalankan command ini? (y/n): ');
      const approved = answer.trim().toLowerCase() === 'y';

      if (!approved) {
        logStep({ task: INSTRUCTION, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        console.log('[DITOLAK] Command dibatalkan, task dihentikan.');
        return;
      }

      const result = await runCommand(step.command);
      console.log(`[EXIT ${result.code}] stdout: ${result.stdout || '(kosong)'}`);
      if (result.stderr) console.log(`[STDERR] ${result.stderr}`);

      logStep({ task: INSTRUCTION, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      history.push({ action: 'bash', command: step.command, approved: true, result });
      continue;
    }
  }

  console.log(`\n[BERHENTI] Sampai batas ${MAX_LOOPS} langkah tanpa selesai.`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

