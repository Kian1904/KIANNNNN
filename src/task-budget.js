// M40: budget per task, fail-closed kalau habis.
export function createTaskBudget({ maxSteps = 25, maxSearches = 2, maxFetches = 3, maxProviderCalls = 8 } = {}) {
  const used = { steps: 0, searches: 0, fetches: 0, providerCalls: 0 };
  const limits = { steps: maxSteps, searches: maxSearches, fetches: maxFetches, providerCalls: maxProviderCalls };

  const ALIAS = { step: 'steps', search: 'searches', fetch: 'fetches', providerCall: 'providerCalls' };

  function consume(kind) {
    const key = ALIAS[kind] || kind;
    if (!(key in used)) return false;
    used[key]++;
    if (used[key] > limits[key]) { used[key]--; return false; }
    return true;
  }

  function snapshot() {
    return {
      used: { ...used },
      limits: { ...limits },
      remaining: {
        steps: limits.steps - used.steps,
        searches: limits.searches - used.searches,
        fetches: limits.fetches - used.fetches,
        providerCalls: limits.providerCalls - used.providerCalls,
      }
    };
  }

  return { consume, snapshot };
}
