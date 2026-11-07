import { buildEditPlan, buildDestructivePlan, destructiveVerb, formatDestructivePreview } from '../src/core/file-execution.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => condition ? (pass++, console.log(`  PASS ${label}`)) : (fail++, console.log(`  FAIL ${label}`));

const edit = buildEditPlan('src/a.js', 'old', 'new');
check('edit plan preserves target', edit.target === 'src/a.js');
check('edit plan detects existing file', edit.existedBefore === true);
check('edit plan stores previous content', edit.oldContent === 'old');
check('edit plan marks new file', buildEditPlan('x', '', 'v').existedBefore === false);

const destructive = buildDestructivePlan('rename', 'a.txt', 'b.txt', { ok: true, kind: 'file', content: 'x' });
check('destructive plan preserves operation', destructive.action === 'rename');
check('destructive plan preserves destination', destructive.dest === 'b.txt');
check('delete preview includes content', formatDestructivePreview({ action: 'delete', target: 'a', info: { ok: true, kind: 'file', content: 'line', preview: 'line', more: 0 }, description: 'File: a' }).includes('DIHAPUS'));
check('verbs are stable', destructiveVerb('delete') === 'dihapus' && destructiveVerb('rename', 'b') === 'di-rename ke b');

console.log(`\n=== HASIL FILE-EXECUTION-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
