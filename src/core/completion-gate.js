/**
 * Pure completion decision. It evaluates facts supplied by the task loop and
 * never performs I/O, prints, calls the model, or writes the journal.
 */
export function evaluateCompletion({
  checklist = null,
  summary = '',
  history = [],
  contract = null,
  evidence = [],
  testResult = null,
  review = null,
} = {}) {
  if (checklist && Array.isArray(checklist.items) && checklist.items.some(item => item.status !== 'completed')) {
    return reject('checklist masih pending', { evidence, testResult, review });
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    return reject('summary kosong', { evidence, testResult, review });
  }
  const failed = history.find(item => item && item.verified === false);
  if (failed) {
    return reject(`aksi ${failed.action || 'unknown'} belum terverifikasi: ${failed.error || 'hasil gagal'}`, { evidence, testResult, review });
  }
  if (testResult?.required && testResult.passed !== true) {
    return reject(`test project gagal: ${testResult.summary || 'hasil tidak lulus'}`, { evidence, testResult, review });
  }
  const pending = evidence.filter(item => item && item.status !== 'completed');
  if (pending.length > 0 || (contract?.acceptance?.length > 0 && evidence.length === 0)) {
    return reject('evidence contract belum lengkap', { evidence, testResult, review });
  }
  if (review && String(review.verdict).toLowerCase() === 'reject') {
    return reject('independent review menolak hasil', { evidence, testResult, review });
  }
  return { approved: true, reason: 'semua completion gate lolos', evidence, testResult, review };
}

function reject(reason, details) {
  return { approved: false, reason, ...details };
}
