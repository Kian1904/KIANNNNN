// M39: circuit breaker per provider, tanpa leak secret.
export function createProviderHealth({ cooldownMs = 60000 } = {}) {
  const state = new Map();

  function isAvailable(name) {
    const s = state.get(name);
    if (!s) return true;
    if (s.cooldownUntil && Date.now() < s.cooldownUntil) return false;
    return true;
  }

  function recordFailure(name, info = {}) {
    const retryAfter = Number(info.retryAfter) || 0;
    const cooldown = Math.max(cooldownMs, retryAfter * 1000);
    state.set(name, {
      failures: (state.get(name)?.failures || 0) + 1,
      lastStatus: info.status || null,
      cooldownUntil: Date.now() + cooldown,
    });
  }

  function recordSuccess(name) {
    state.delete(name);
  }

  function snapshot() {
    const out = {};
    for (const [k, v] of state.entries()) {
      out[k] = { failures: v.failures, lastStatus: v.lastStatus, cooldownUntil: v.cooldownUntil };
    }
    return out;
  }

  return { isAvailable, recordFailure, recordSuccess, snapshot };
}
