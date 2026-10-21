// M25 RED/GREEN: write, append, mkdir harus satu gate dan fail-closed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspectTarget, rejectWriteReason, applySafeFileOp } from '../src/file-ops.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, '.tmp-write-'));
let pass = 0, fail = 0;
const check = (l, c) => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}`));

try {
  const fresh = path.join(tmp, 'new.txt');
  check('write file baru sukses', applySafeFileOp('write', fresh, 'halo').ok && fs.readFileSync(fresh, 'utf8') === 'halo');
  check('write file existing ditolak', !applySafeFileOp('write', fresh, 'overwrite').ok && fs.readFileSync(fresh, 'utf8') === 'halo');
  check('append sukses', applySafeFileOp('append', fresh, ' dunia').ok && fs.readFileSync(fresh, 'utf8') === 'halo dunia');
  check('mkdir sukses', applySafeFileOp('mkdir', path.join(tmp, 'a', 'b')).ok && fs.statSync(path.join(tmp, 'a', 'b')).isDirectory());
  check('mkdir existing ditolak', !applySafeFileOp('mkdir', path.join(tmp, 'a', 'b')).ok);
  check('write .env diblok', rejectWriteReason(path.join(ROOT, '.env'), 'write') === 'path diblokir karena keamanan');
  check('write parent missing dibuat', applySafeFileOp('write', path.join(tmp, 'deep', 'x.txt'), 'x').ok);
  const info = inspectTarget(fresh);
  check('inspect setelah write membaca isi aktual', info.ok && info.content === 'halo dunia');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n=== HASIL FILE-OPS-WRITE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
