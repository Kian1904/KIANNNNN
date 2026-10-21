// M28: approval queue harus serial, walau worker jalan paralel.
import { createApprovalQueue } from '../src/approval-queue.js';

let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
let active = 0, maxActive = 0;
const seen = [];
const base = async (label) => {
  active++; maxActive = Math.max(maxActive, active); seen.push(`start:${label}`);
  await new Promise(r => setTimeout(r, 15));
  seen.push(`end:${label}`); active--;
  return { approved: true, condition: null };
};
const ask = createApprovalQueue(base);
const out = await Promise.all(['A', 'B', 'C'].map(x => ask(x)));
check('semua approval selesai', out.length === 3 && out.every(x => x.approved));
check('approval tidak overlap', maxActive === 1);
check('urutan FIFO', seen.join(',') === 'start:A,end:A,start:B,end:B,start:C,end:C');
check('queue exposes idle state', ask.isIdle());

const reject = createApprovalQueue(async () => { throw new Error('approval boom'); });
let threw = false;
try { await reject('x'); } catch (e) { threw = /approval boom/.test(e.message); }
check('error base diteruskan', threw);
check('queue pulih setelah error', reject.isIdle());

console.log(`\n=== HASIL APPROVAL-QUEUE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
