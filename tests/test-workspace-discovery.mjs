import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverWorkspaceRoot, getWorkspaceRoot } from '../src/core/workspace.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kian-discover-')); fs.mkdirSync(path.join(root,'project')); fs.writeFileSync(path.join(root,'project','AGENT.md'),'x');
const found=discoverWorkspaceRoot(path.join(root,'project','nested'));
const ok=found===path.join(root,'project') && getWorkspaceRoot()===found;
console.log(ok?'PASS workspace discovery':'FAIL workspace discovery'); fs.rmSync(root,{recursive:true,force:true}); if(!ok)process.exit(1);
