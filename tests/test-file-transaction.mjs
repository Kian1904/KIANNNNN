// M57 RED: multi-file transaction — all-or-nothing file operations.
import {
  TX_STATUS, beginTransaction, addOperation, commitTransaction,
  rollbackTransaction, getTransactionStatus, listOperations,
} from '../src/file-transaction.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] beginTransaction ────────────────────────────────────────────────────
{
  const tx = beginTransaction({ id: 'tx1', label: 'edit 3 files' });
  check('begin: punya id', tx.id === 'tx1');
  check('begin: punya label', tx.label === 'edit 3 files');
  check('begin: status PENDING', tx.status === TX_STATUS.PENDING);
  check('begin: operations kosong', tx.operations.length === 0);
  check('begin: punya timestamp', typeof tx.startedAt === 'string');
}

// ── [2] addOperation ────────────────────────────────────────────────────────
{
  const tx = beginTransaction({ id: 'tx2' });
  addOperation(tx, { type: 'write', target: 'a.js', content: 'hello' });
  addOperation(tx, { type: 'edit', target: 'b.js', oldContent: 'x', newContent: 'y' });
  addOperation(tx, { type: 'delete', target: 'c.js' });

  check('add: 3 operations', tx.operations.length === 3);
  check('add: tipe tercatat', tx.operations[0].type === 'write');
  check('add: target tercatat', tx.operations[1].target === 'b.js');
  check('add: setiap op punya index', tx.operations.every((o, i) => o.index === i));
}

// ── [3] commitTransaction ───────────────────────────────────────────────────
{
  const tx = beginTransaction({ id: 'tx3' });
  addOperation(tx, { type: 'write', target: 'x.js', content: 'a' });

  // Simulasi semua operasi berhasil
  const result = commitTransaction(tx, (op) => ({ ok: true, applied: true }));
  check('commit: status COMMITTED', result.status === TX_STATUS.COMMITTED);
  check('commit: semua operations applied', result.operations.every(o => o.applied === true));
  check('commit: ada committedAt', typeof result.committedAt === 'string');
}

// ── [4] rollbackTransaction (gagal di tengah) ───────────────────────────────
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kian-m57-'));

  const tx = beginTransaction({ id: 'tx4' });
  addOperation(tx, { type: 'write', target: path.join(dir, 'a.txt'), content: 'original A' });
  addOperation(tx, { type: 'write', target: path.join(dir, 'b.txt'), content: 'original B' });
  addOperation(tx, { type: 'write', target: path.join(dir, 'c.txt'), content: 'original C' });

  // Simulasi: operasi ke-2 gagal saat commit -> auto-rollback
  let callCount = 0;
  const result = commitTransaction(tx, (op) => {
    callCount++;
    if (callCount === 2) return { ok: false, error: 'disk full' };
    return { ok: true, applied: true };
  });

  check('rollback: status ROLLED_BACK', result.status === TX_STATUS.ROLLED_BACK);
  check('rollback: ada rollbackReason', result.rollbackReason === 'disk full');
  check('rollback: operasi yang sudah applied di-rollback', result.operations.filter(o => o.rolledBack).length > 0);
  check('rollback: operasi sebelum gagal di-rollback', result.operations[0].rolledBack === true);
  check('rollback: operasi gagal tidak dianggap applied', result.operations[1].applied !== true);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── [5] getTransactionStatus ────────────────────────────────────────────────
{
  const tx = beginTransaction({ id: 'tx5' });
  check('status: PENDING sebelum commit', getTransactionStatus(tx) === TX_STATUS.PENDING);
  commitTransaction(tx, () => ({ ok: true }));
  check('status: COMMITTED setelah commit', getTransactionStatus(tx) === TX_STATUS.COMMITTED);
}
{
  const tx = beginTransaction({ id: 'tx5b' });
  addOperation(tx, { type: 'write', target: 'x' });
  rollbackTransaction(tx, () => ({ ok: false, error: 'x' }));
  check('status: ROLLED_BACK setelah rollback', getTransactionStatus(tx) === TX_STATUS.ROLLED_BACK);
}

// ── [6] listOperations ──────────────────────────────────────────────────────
{
  const tx = beginTransaction({ id: 'tx6' });
  addOperation(tx, { type: 'write', target: 'a' });
  addOperation(tx, { type: 'edit', target: 'b' });
  const ops = listOperations(tx);
  check('list: semua operasi', ops.length === 2);
  check('list: immutable copy', ops !== tx.operations);
}

// ── [7] TX_STATUS ───────────────────────────────────────────────────────────
{
  check('status: PENDING', TX_STATUS.PENDING === 'pending');
  check('status: COMMITTED', TX_STATUS.COMMITTED === 'committed');
  check('status: ROLLED_BACK', TX_STATUS.ROLLED_BACK === 'rolled_back');
  check('status: FAILED', TX_STATUS.FAILED === 'failed');
}

// ── [8] Robustness ──────────────────────────────────────────────────────────
{
  check('begin: tanpa id tidak crash', typeof beginTransaction({}) === 'object');
  check('add: null tx tidak crash', (() => { try { addOperation(null, {}); return true; } catch { return false; } })());
  check('commit: null tx tidak crash', (() => { try { commitTransaction(null, () => ({ ok: true })); return true; } catch { return false; } })());
  check('rollback: null tx tidak crash', (() => { try { rollbackTransaction(null, () => ({ ok: true })); return true; } catch { return false; } })());
  check('commit: tanpa executor tidak crash', typeof commitTransaction(beginTransaction({ id: 'x' })) === 'object');
}

console.log(`\n=== HASIL FILE-TRANSACTION: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
