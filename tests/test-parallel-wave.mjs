// M28: Promise.allSettled per wave, dependency wave tetap serial.
import { executePlan } from '../src/orchestrator.js';
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));
const p = { ok: true, tasks: [
  { id: 1, role: 'researcher', brief: 'Riset sistem A dengan detail teknis', dependsOn: null },
  { id: 2, role: 'reviewer', brief: 'Periksa sistem B dengan detail teknis', dependsOn: null },
  { id: 3, role: 'coder', brief: 'Implementasikan hasil task 1 dan task 2', dependsOn: 1 },
], problems: [] };
let active = 0, maxActive = 0; let task3SawDeps = false;
const started = [];
const runTask = async (instruction) => {
  active++; maxActive = Math.max(maxActive, active); started.push(instruction);
  await new Promise(r => setTimeout(r, 20));
  const isCoder = instruction.includes('role coder');
  if (isCoder) task3SawDeps = instruction.includes('task 1') || instruction.includes('worker');
  active--;
  return isCoder ? 'coder verified' : 'worker verified';
};
const r = await executePlan(p, { originalInstruction: 'kerjakan sistem', agentMd: null, availableTools: [], threadId: null, stats: null, trackProvider: null, trackAction: null, isDangerous: () => false, askApproval: async () => ({ approved: true }) }, { runTask });
check('parallel wave tetap sukses', r.ok && r.results.length === 3);
check('wave 1 benar-benar overlap', maxActive === 2);
check('dependency wave jalan sesudah wave 1', task3SawDeps);
check('evidence semua worker', r.results.every(x => x.verified && x.evidence?.length));
console.log(`\n=== HASIL PARALLEL-WAVE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
