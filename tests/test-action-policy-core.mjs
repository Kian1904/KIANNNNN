import { checkAllowedAction } from '../src/core/action-policy.js';

let pass = 0;
let fail = 0;
const check = (label, condition) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

check('generic agent allows any action', checkAllowedAction(null, 'bash').allowed === true);
check('role allows listed action', checkAllowedAction({ name: 'reviewer', actions: ['read', 'bash'] }, 'read').allowed === true);
check('role rejects unlisted action', checkAllowedAction({ name: 'reviewer', actions: ['read'] }, 'edit').allowed === false);
check('done is always allowed', checkAllowedAction({ name: 'reviewer', actions: ['read'] }, 'done').allowed === true);
check('rejection includes role and action', /reviewer.*edit|edit.*reviewer/i.test(checkAllowedAction({ name: 'reviewer', actions: ['read'] }, 'edit').reason));

console.log(`\n=== HASIL ACTION-POLICY-CORE: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
