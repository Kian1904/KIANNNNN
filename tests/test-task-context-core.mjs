import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskContext } from '../src/core/task-context.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-context-'));
const ctx = createTaskContext({
  instruction: 'buat file demo lalu test',
  agentConfig: { name: 'coder' },
  threadId: 7,
  journalDir: dir,
  journalEnabled: true,
});

check('context builds contract', ctx.contract.acceptance.length > 0);
check('context starts journal', fs.existsSync(ctx.journal.path));
ctx.journalLog({ type: 'note', text: 'hello' });
check('journalLog appends safely', ctx.journal.lastSeq === 2);
ctx.pushHistory({ action: 'read', verified: true });
check('pushHistory stores action', ctx.history.length === 1);
check('pushHistory journals action', ctx.journal.lastSeq === 3);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== HASIL TASK-CONTEXT-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
