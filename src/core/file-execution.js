/** Pure planning/formatting for edit and destructive file actions. */
export function buildEditPlan(target, oldContent = '', newContent = '') {
  return { action: 'edit', target, oldContent: String(oldContent), newContent: String(newContent), existedBefore: String(oldContent).length > 0 };
}

export function buildDestructivePlan(action, target, dest, info = {}) {
  return { action, target, dest: dest || null, info };
}

export function destructiveVerb(action, dest) {
  if (action === 'delete') return 'dihapus';
  if (action === 'rename') return `di-rename ke ${dest}`;
  return `dipindah ke ${dest}`;
}

export function formatDestructivePreview({ action, target, info = {}, description = '' } = {}) {
  if (info.kind === 'file_binary') return description;
  if (action !== 'delete' || info.content === null || info.content === undefined) return description;
  const lines = (info.preview || '').split('\n').map((line, i) => `  ${i + 1} | ${line}`).join('\n');
  return `${description}\n\nIsi yang bakal DIHAPUS:\n${lines}${info.more > 0 ? `\n  ... (${info.more} baris lagi)` : ''}`;
}
