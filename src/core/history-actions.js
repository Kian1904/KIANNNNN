/** Pure builders for non-result history events. */
export function historyError(action, error, fields = {}) {
  return { action, ...fields, verified: false, error };
}
export function historyCondition(condition) { return { action: 'user_condition', condition }; }
export function historyNote(text) { return { action: 'note', text }; }
