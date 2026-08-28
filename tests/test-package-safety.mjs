import { checkPackageSafety } from '../src/package-safety.js';
import { runCommand } from '../src/bash.js';

async function testPackageSafety() {
  console.log('=== Testing package-safety ===\n');

  const commands = [
    'pkg install git',
    'pkg install gti',
    'pkg install python',
    'pkg install pytnon',
    'pkg install unknownxyz',
    'npm install lodash',
    'npm install lodashx',
  ];

  for (const cmd of commands) {
    console.log(`\n> ${cmd}`);
    const result = await checkPackageSafety(cmd);
    if (result) {
      console.log('  flags:', result.flags.join('\n         '));
      console.log('  blocked:', result.blocked);
    } else {
      console.log('  (no package extracted)');
    }
  }
}

testPackageSafety().catch(console.error);