// M57: multi-file transaction — all-or-nothing file operations.
//
// Kenapa ini ada: agent bisa edit 5 file, tapi kalau file ke-3 gagal, file 1-2
// tetap ke-edit. Tidak ada rollback transaksional. M57 memungkinkan operasi file
// dikelompokkan jadi transaction: kalau satu gagal, SEMUA di-rollback.
//
// Prinsip: all-or-nothing. Tidak ada state setengah jadi.
//
// Written by K'

export const TX_STATUS = Object.freeze({
  PENDING: 'pending',
  COMMITTED: 'committed',
  ROLLED_BACK: 'rolled_back',
  FAILED: 'failed',
});

/**
 * Mulai transaksi baru.
 * @param {{id?:string, label?:string}} input
 * @returns {object} transaction state
 */
export function beginTransaction(input = {}) {
  return {
    id: input.id || `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: input.label || '',
    status: TX_STATUS.PENDING,
    operations: [],
    startedAt: new Date().toISOString(),
    committedAt: null,
    rolledBackAt: null,
    rollbackReason: null,
  };
}

/**
 * Tambah operasi ke transaksi (belum dieksekusi).
 * @param {object} tx
 * @param {{type:string, target:string, content?:string, oldContent?:string, newContent?:string}} op
 */
export function addOperation(tx, op = {}) {
  if (!tx || tx.status !== TX_STATUS.PENDING) return;
  tx.operations.push({
    index: tx.operations.length,
    type: op.type || 'write',
    target: op.target || '',
    content: op.content,
    oldContent: op.oldContent,
    newContent: op.newContent,
    applied: false,
    rolledBack: false,
    error: null,
  });
}

/**
 * Commit transaksi: eksekusi semua operasi secara berurutan.
 * Kalau SEMUA berhasil → COMMITTED. Kalau ada yang gagal → otomatis rollback.
 *
 * @param {object} tx
 * @param {Function} executor - (op) => { ok: boolean, applied?: boolean, error?: string }
 * @returns {object} transaction state final
 */
export function commitTransaction(tx, executor = () => ({ ok: true })) {
  if (!tx) return { status: TX_STATUS.FAILED };
  if (tx.status !== TX_STATUS.PENDING) return tx;

  for (const op of tx.operations) {
    let result;
    try {
      result = executor(op) || { ok: false, error: 'executor tidak mengembalikan hasil' };
    } catch (err) {
      result = { ok: false, error: err.message };
    }

    if (!result.ok) {
      // Operasi gagal -> rollback semua yang sudah applied.
      op.error = result.error || 'unknown error';
      rollbackTransaction(tx, () => ({ ok: true }), op.error);
      return tx;
    }

    op.applied = true;
  }

  tx.status = TX_STATUS.COMMITTED;
  tx.committedAt = new Date().toISOString();
  return tx;
}

/**
 * Rollback transaksi: batalkan operasi yang sudah applied.
 *
 * @param {object} tx
 * @param {Function} rollbackExecutor - (op) => { ok: boolean }
 * @param {string} reason - alasan rollback
 * @returns {object} transaction state final
 */
export function rollbackTransaction(tx, rollbackExecutor = () => ({ ok: true }), reason = '') {
  if (!tx) return { status: TX_STATUS.FAILED };

  // Rollback operasi yang sudah applied (urutan terbalik).
  const applied = tx.operations.filter(o => o.applied).reverse();
  for (const op of applied) {
    try {
      rollbackExecutor(op);
    } catch { /* rollback gagal tidak boleh crash */ }
    op.rolledBack = true;
    op.applied = false;
  }

  tx.status = TX_STATUS.ROLLED_BACK;
  tx.rolledBackAt = new Date().toISOString();
  tx.rollbackReason = reason || 'manual rollback';
  return tx;
}

/**
 * Dapatkan status transaksi.
 */
export function getTransactionStatus(tx) {
  return tx ? tx.status : TX_STATUS.FAILED;
}

/**
 * Daftar operasi dalam transaksi (copy, immutable).
 */
export function listOperations(tx) {
  return tx ? [...tx.operations] : [];
}
