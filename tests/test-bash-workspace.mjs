import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setWorkspaceRoot } from '../src/core/workspace.js';
import { runCommand } from '../src/bash.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-bash-ws-'));
setWorkspaceRoot(root);
try {
  const result = await runCommand('pwd');
  const ok = result.ok && result.stdout.trim() === root;
  console.log(ok ? 'PASS bash defaults to workspace cwd' : `FAIL bash cwd: ${result.stdout}`);
  if (!ok) process.exitCode = 1;
} finally { fs.rmSync(root, { recursive: true, force: true }); }
