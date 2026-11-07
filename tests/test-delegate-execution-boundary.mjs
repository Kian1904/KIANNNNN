import { executeDelegate } from '../src/core/execution/delegate.js';
const r=await executeDelegate('q','t',{},{delegateTask:async(a,t)=>({ok:true,agent:a,summary:t})});
console.log(r.ok&&r.agent==='q'?'PASS delegate boundary delegates':'FAIL delegate boundary delegates');
if(!r.ok)process.exit(1);
