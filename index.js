import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { askGroq } from './lib/groq.js';
import { planEdit } from './lib/plan.js';
import { showDiff } from './lib/diff.js';

const TARGET_FILE = process.argv[2];
const INSTRUCTION = process.argv[3];

if (!TARGET_FILE || !INSTRUCTION) {
  console.error('Pakai: node index.js <file> "<instruksi>"');
  console.error('Contoh: node index.js sample.txt "tambahin baris penutup salam"');
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  // 1. READ
  if (!fs.existsSync(TARGET_FILE)) {
    console.error(`File tidak ditemukan: ${TARGET_FILE}`);
    process.exit(1);
  }
  const currentContent = fs.readFileSync(TARGET_FILE, 'utf8');
  console.log(`[READ] ${TARGET_FILE} (${currentContent.length} karakter)`);

  // 2. PLAN
  console.log(`[PLAN] Minta Groq rencanain perubahan...`);
  const plan = await planEdit(askGroq, currentContent, INSTRUCTION);
  console.log(`[PLAN] Alasan: ${plan.reasoning}`);

  // 3. DIFF
  console.log(`\n--- DIFF ---`);
  console.log(showDiff(currentContent, plan.new_content));
  console.log(`--- END DIFF ---\n`);

  // 4. APPROVAL
  const answer = await ask('Terapkan perubahan ini? (y/n): ');
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('[BATAL] Tidak ada yang diubah.');
    return;
  }

  // 5. WRITE
  fs.writeFileSync(TARGET_FILE, plan.new_content, 'utf8');
  console.log(`[WRITE] ${TARGET_FILE} berhasil diupdate.`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

