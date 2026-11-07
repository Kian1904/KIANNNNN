import { executeSafeMutation, executeDestructive, lintWrittenFile } from '../src/core/execution/files.js';
let pass=0,fail=0; const check=(l,c)=>c?(pass++,console.log(`  PASS ${l}`)):(fail++,console.log(`  FAIL ${l}`));
check('safe mutation delegates',executeSafeMutation('write','x','v',{applySafeFileOp:()=>({ok:true})}).ok===true);
check('destructive delegates',executeDestructive('delete','x',null,{applyFileOp:()=>({ok:true})}).ok===true);
check('lint delegates',lintWrittenFile('x.js','old',{lintAfterWrite:()=>({ok:true})}).ok===true);
console.log(`\n=== HASIL FILE-EXECUTION-BOUNDARY: ${pass} pass, ${fail} fail ===`); if(fail)process.exit(1);
