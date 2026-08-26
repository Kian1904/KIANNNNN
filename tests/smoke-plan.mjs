import { planStep } from '../lib/plan.js';

const base = { fileSnapshot: '-', agentMd: null, recentMemory: [], availableTools: [] };
let calls = 0;

// T1: parsing ACTION chat
calls = 0;
const askChat = async () => {
  calls++;
  return calls === 1
    ? 'REASONING: user nanya\nACTION: chat\nREPLY: Halo! Ada yang bisa dibantu?'
    : 'REASONING: selesai\nACTION: done\nSUMMARY: ok';
};
const s1 = await planStep(askChat, { ...base, instruction: 'halo', history: [] });
if (s1.action !== 'chat' || !s1.reply.includes('Halo')) throw new Error('T1 GAGAL: ' + JSON.stringify(s1));
console.log('T1 chat parse        : OK ->', JSON.stringify(s1.reply));

// T2: history berisi bash approved — dulu ReferenceError di sini
const hist = [
  { action: 'bash', command: 'ls -la', approved: true, result: { ok: true, stdout: 'file.txt', stderr: '', code: 0 } },
  { action: 'edit', target: 'foo.txt', approved: true },
];
const askDone = async () => 'REASONING: beres\nACTION: done\nSUMMARY: selesai';
const s2 = await planStep(askDone, { ...base, instruction: 'list file', history: hist });
if (s2.action !== 'done') throw new Error('T2 GAGAL: ' + JSON.stringify(s2));
console.log('T2 bash history      : OK (tidak crash) ->', s2.summary);

// T3: parsing edit tetap jalan setelah chat handler disisipkan sebelum fallback edit
const askEdit = async () => 'REASONING: update\nACTION: edit\nTARGET: foo.txt\n===CONTENT_START===\nhello world\n===CONTENT_END===';
const s3 = await planStep(askEdit, { ...base, instruction: 'tulis foo.txt', history: [] });
if (s3.action !== 'edit' || s3.target !== 'foo.txt' || s3.new_content !== 'hello world') {
  throw new Error('T3 GAGAL: ' + JSON.stringify(s3));
}
console.log('T3 edit parse        : OK ->', s3.target, '|', JSON.stringify(s3.new_content));

// T4: defaultModel Nvidia tanpa trailing quote
const prov = await import('../lib/providers.js');
console.log('T4 providers import  : OK (module load bersih)');

console.log('\nSEMUA TEST LULUS');
