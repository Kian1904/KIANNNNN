import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setWorkspaceRoot } from '../src/core/workspace.js';
import { applySafeFileOp, inspectTarget, applyFileOp, lintAfterWrite } from '../src/file-ops.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-fileops-'));
setWorkspaceRoot(root);
let pass = 0; let fail = 0;
const check = (label, ok) => { if (ok) { pass++; console.log(`PASS ${label}`); } else { fail++; console.log(`FAIL ${label}`); } };
try {
  check('relative write uses workspace', applySafeFileOp('write', 'a.txt', 'hello').ok && fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'hello');
  check('relative inspect uses workspace', inspectTarget('a.txt').content === 'hello');
  check('relative append uses workspace', applySafeFileOp('append', 'a.txt', '!').ok && fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'hello!');
  check('relative rename uses workspace', applyFileOp('rename', 'a.txt', 'b.txt').ok && fs.existsSync(path.join(root, 'b.txt')));
  fs.writeFileSync(path.join(root, 'b.js'), 'const ok = true;');
  check('relative lint uses workspace', lintAfterWrite('b.js', null).ok === true);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`=== HASIL FILE-OPS-WORKSPACE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
