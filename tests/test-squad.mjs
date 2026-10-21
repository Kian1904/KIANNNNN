// tests/test-squad.mjs — M16: topologicalWaves + executePlan (mock provider).
// Written by K-sRouter

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SETTINGS = path.join(ROOT, '.settings.json');

const { topologicalWaves, executePlan, plan } = await import('../src/orchestrator.js');
const { askWithFallback } = await import('../src/providers.js');
const { createThread } = await import('../src/db.js');

const TID = createThread();
let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  ✓ ${l}`)) : (fail++, console.log(`  ✗ ${l}${x ? ' — ' + x : ''}`));

// ── unit topologicalWaves ──
console.log('\n[1] topologicalWaves');
const W = (id, role, dep) => ({ id, role, brief: `t${id}`, dependsOn: dep });
check('chain 1→2 jadi 2 wave', JSON.stringify(topologicalWaves([W(1,'researcher',null), W(2,'coder',1)]).map(w=>w.map(t=>t.id))) === '[[1],[2]]');
check('2 task independen jadi 1 wave', JSON.stringify(topologicalWaves([W(1,'researcher',null), W(2,'reviewer',null)]).map(w=>w.map(t=>t.id))) === '[[1,2]]');
check('chain panjang 1→2→3', JSON.stringify(topologicalWaves([W(1,'researcher',null),W(2,'coder',1),W(3,'reviewer',2)]).map(w=>w.map(t=>t.id))) === '[[1],[2],[3]]');

// cycle (shouldn't reach executePlan, but defensive)
let threw = false;
try { topologicalWaves([W(1,'coder',2), W(2,'coder',1)]); } catch { threw = true; }
check('cycle melempar error', threw);

// ── integration executePlan (mock provider) ──
function makeServer(replies) {
  let i = 0;
  const s = http.createServer((req, res) => {
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>{
      const content = replies[Math.min(i, replies.length-1)]; i++;
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
    });
  });
  return new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s)));
}

const real = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS,'utf8') : null;
try {
  // Skenario: researcher (task1) → coder (task2 dependsOn 1)
  // Urutan balasan: [plan valid] [researcher done] [coder done]
  console.log('\n[2] executePlan handoff dependency');
  const srv = await makeServer([
    JSON.stringify({tasks:[
      {id:1,role:'researcher',brief:'Riset cara kerja SQLite untuk fitur X',dependsOn:null},
      {id:2,role:'coder',brief:'Implementasikan fitur X memakai hasil riset task 1',dependsOn:1},
    ]}),
    'REASONING: riset\nACTION: done\nSUMMARY: Hasil riset X: pakai SQLite.',
    'REASONING: kode\nACTION: done\nSUMMARY: Selesai implement X dengan SQLite.',
  ]);
  fs.writeFileSync(SETTINGS, JSON.stringify([{name:'mock',baseUrl:`http://127.0.0.1:${srv.address().port}/v1`,apiKey:'t',model:'mock-1',active:true}]));

  const p = await plan('riset X lalu bikin kodenya', askWithFallback);
  check('plan() ok 2 task', p.ok && p.tasks.length===2, JSON.stringify(p.problems));

  const deny = async()=>({approved:false,condition:null});
  const exec = await executePlan(p, {
    originalInstruction:'riset X lalu bikin kodenya',
    agentMd:null, availableTools:[], threadId:TID,
    stats:null, trackProvider:null, trackAction:null,
    isDangerous:()=>false, askApproval:deny,
  });
  check('executePlan ok', exec.ok && exec.results.length===2, JSON.stringify(exec.problems));
  check('handoff: summary researcher masuk ke instruksi coder', exec.results[1].summary.includes('SQLite'));
  check('finalSummary gabung kedua task', exec.finalSummary.includes('researcher') && exec.finalSummary.includes('coder'));
  srv.close();
} finally {
  if (real!==null) fs.writeFileSync(SETTINGS, real, 'utf8');
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
}

// ── M17: error isolation per worker ──
console.log('\n[3] executePlan error isolation (M17)');
{
  const pFake = { ok: true, tasks: [
    { id: 1, role: 'coder', brief: 'a', dependsOn: null },
    { id: 2, role: 'reviewer', brief: 'b', dependsOn: 1 },
  ], problems: [] };
  let ran2 = false;
  const exec2 = await executePlan(pFake, {
    originalInstruction: 'x', agentMd: null, availableTools: [], threadId: TID,
    stats: null, trackProvider: null, trackAction: null,
    isDangerous: () => false, askApproval: async () => ({ approved: true, condition: null }),
  }, {
    runTask: async (instr) => {
      if (instr.includes('role coder')) throw new Error('BOOM');
      ran2 = true;
      return 'review lolos';
    },
  });
  check('squad menahan final sukses walau task1 crash', !exec2.ok && exec2.results.length === 2, JSON.stringify(exec2.problems));
  check('error task1 dikarantina jadi summary', exec2.results[0].summary.includes('TASK GAGAL') && exec2.results[0].summary.includes('BOOM'));
  check('task2 tetap jalan (dependency terima info error)', ran2 && exec2.results[1].summary === 'review lolos');
  check('finalSummary memuat error + hasil task2', exec2.finalSummary.includes('TASK GAGAL') && exec2.finalSummary.includes('review lolos'));
}

console.log(`\n=== HASIL M16: ${pass} pass, ${fail} fail ===`);
process.exit(fail>0?1:0);
