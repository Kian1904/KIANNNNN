/** Pure action-result builders shared by the execution loop. */
export function buildEditHistory(target, verified, error) {
  return { action: 'edit', target, approved: true, verified: verified === true, error: verified === true ? undefined : error };
}

export function buildDestructiveHistory(action, target, dest, verified = true, error) {
  return { action, target, dest, approved: true, verified: verified === true, error: verified === true ? undefined : error };
}

export function buildWebHistory(action, target, summary, verified, error) {
  return { action, ...(action === 'web_search' ? { query: target } : { url: target }), summary, verified: verified === true, error: verified === true ? undefined : error };
}

export function buildMcpHistory(tool, result, error) {
  return { action: 'mcp_call', tool, result, ...(error ? { error } : {}) };
}

export function buildChatHistory(reply) { return { action: 'chat', reply }; }
export function buildRememberHistory(key, value) { return { action: 'remember', key, value }; }
export function buildReadHistory(target, content, range) { return { action: 'read', target, content, range }; }
export function buildListHistory(target, listing) { return { action: 'list_dir', target, listing }; }
export function buildDelegateHistory(agent, task, fields = {}) { return { action: 'delegate', agent, task, ...fields }; }
