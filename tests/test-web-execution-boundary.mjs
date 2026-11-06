import { executeSearch, executeFetch } from '../src/core/execution/web.js';
let pass=0,fail=0; const check=(l,c)=>c?(pass++,console.log(`  PASS ${l}`)):(fail++,console.log(`  FAIL ${l}`));
check('search boundary delegates',(await executeSearch('x',{searchWeb:async q=>({provider:'x',results:[q]})})).results[0]==='x');
check('fetch boundary delegates',(await executeFetch('u',{fetchWebPage:async u=>({ok:true,url:u})})).url==='u');
console.log(`\n=== HASIL WEB-EXECUTION-BOUNDARY: ${pass} pass, ${fail} fail ===`); if(fail)process.exit(1);
