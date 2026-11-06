/** Format read/list results for the execution layer. */
export function formatReadResult(target, result = {}) {
  const label = result.ok && result.totalLines > (result.end - result.start + 1)
    ? `${target} (baris ${result.start}-${result.end} dari ${result.totalLines})`
    : target;
  return { label, content: result.content ?? '' };
}

export function normalizeListTarget(target) {
  return (target || '.').trim();
}
