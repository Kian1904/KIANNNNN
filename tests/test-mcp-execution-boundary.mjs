import { executeMcp } from '../src/core/execution/mcp.js';
const r=await executeMcp('x',{a:1},[],{callTool:async(t,a)=>`${t}:${a.a}`});
console.log(r==='x:1'?'PASS mcp boundary delegates':'FAIL mcp boundary delegates');
if(r!=='x:1')process.exit(1);
