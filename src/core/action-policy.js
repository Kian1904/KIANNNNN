/** Return the permission decision for one parsed agent action. */
export function checkAllowedAction(agentConfig, action) {
  if (!agentConfig || action === 'done') return { allowed: true, reason: '' };
  const allowed = Array.isArray(agentConfig.actions) && agentConfig.actions.includes(action);
  if (allowed) return { allowed: true, reason: '' };
  return {
    allowed: false,
    reason: `Agent "${agentConfig.name}" tidak boleh ACTION: ${action}. Diizinkan: ${(agentConfig.actions || []).join(', ')}.`,
  };
}
