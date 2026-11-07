/** Pure planning and history mapping for safe file mutations. */
export function buildMutationPlan({ action, target, before = '', content = '' } = {}) {
  let finalContent = null;
  if (action === 'write') finalContent = String(content);
  if (action === 'append') finalContent = String(before) + String(content);
  return { action, target, before: String(before), content: String(content), finalContent };
}

export function buildMutationHistory(action, target, result = {}, verification = {}) {
  return {
    action,
    target,
    approved: true,
    verified: verification.ok === true,
    error: verification.ok === true ? undefined : (verification.reason || result.error),
  };
}
