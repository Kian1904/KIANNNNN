import fs from 'node:fs';
import path from 'node:path';

const names = ['artifact-registry','shared-artifacts','worker-lifecycle','model-router','tracer','mcp-health','install-check','task-progress','task-resume','budget-engine'];
let pass = 0, fail = 0;
const check = (label, condition) => condition ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));

for (const name of names) check(`${name} isolated`, fs.existsSync(path.join('src', 'experimental', `${name}.js`)));
for (const name of names) check(`${name} absent from core root`, !fs.existsSync(path.join('src', `${name}.js`)));

console.log(`\n=== HASIL MODULE-ISOLATION: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
