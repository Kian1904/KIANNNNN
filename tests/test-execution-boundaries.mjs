import { executeBash } from '../src/core/execution/bash.js';
let pass=0,fail=0; const check=(l,c)=>c?(pass++,console.log(`  PASS ${l}`)):(fail++,console.log(`  FAIL ${l}`));
const result=await executeBash('x',{runCommand:async c=>({ok:true,code:0,stdout:c})});
check('bash boundary delegates command',result.ok===true&&result.stdout==='x');
console.log(`\n=== HASIL EXECUTION-BOUNDARIES: ${pass} pass, ${fail} fail ===`); if(fail)process.exit(1);
