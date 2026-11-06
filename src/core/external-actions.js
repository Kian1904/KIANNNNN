/** Pure request/record builders for external action adapters. */
export function buildDelegateRequest(agent, task, cwd) {
  return { agent, task, options: { cwd, sandbox: true, outputFormat: 'json', timeoutMs: 120_000 } };
}

export function buildMcpRequest(tool, args) {
  return { tool, args };
}

export function buildSearchRecord(query, provider, results = []) {
  const summary = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
  return { action: 'web_search', query, provider, summary: summary || '(tidak ada hasil)', verified: results.length > 0, error: results.length > 0 ? undefined : 'search tidak menghasilkan sumber' };
}

export function buildFetchRecord(url, summary, verified, error) {
  return { action: 'web_fetch', url, summary, verified: verified === true, error: verified === true ? undefined : error };
}
