// M61: cost/token budget engine — kontrol biaya real-time.
// Written by K'

export const BUDGET_KIND = Object.freeze({
  TOKENS: 'tokens',
  COST: 'cost',
  CALLS: 'calls',
});

export function createBudget(input = {}) {
  return {
    limits: {
      maxTokens: Number.isFinite(input.maxTokens) ? input.maxTokens : Infinity,
      maxCostUsd: Number.isFinite(input.maxCostUsd) ? input.maxCostUsd : Infinity,
      maxProviderCalls: Number.isFinite(input.maxProviderCalls) ? input.maxProviderCalls : Infinity,
    },
    usage: { totalTokens: 0, totalCostUsd: 0, providerCalls: 0 },
    startedAt: Date.now(),
  };
}

export function trackUsage(budget, usage = {}) {
  if (!budget) return;
  budget.usage.totalTokens += Number(usage.tokens) || 0;
  budget.usage.totalCostUsd += Number(usage.costUsd) || 0;
  budget.usage.providerCalls += Number(usage.providerCalls) || 0;
}

export function isOverBudget(budget) {
  if (!budget) return false;
  const u = budget.usage;
  const l = budget.limits;
  return u.totalTokens > l.maxTokens
    || u.totalCostUsd > l.maxCostUsd
    || u.providerCalls >= l.maxProviderCalls;
}

export function getBudgetReport(budget) {
  if (!budget) return '';
  const u = budget.usage;
  const l = budget.limits;
  const pct = (v, max) => max === Infinity ? '∞' : `${Math.round((v / max) * 100)}%`;
  return [
    `Tokens: ${u.totalTokens}/${l.maxTokens === Infinity ? '∞' : l.maxTokens} (${pct(u.totalTokens, l.maxTokens)})`,
    `Cost: $${u.totalCostUsd.toFixed(3)}/${l.maxCostUsd === Infinity ? '∞' : '$' + l.maxCostUsd.toFixed(2)}`,
    `Provider calls: ${u.providerCalls}/${l.maxProviderCalls === Infinity ? '∞' : l.maxProviderCalls}`,
  ].join('\n');
}

export function estimateCost({ inputTokens = 0, outputTokens = 0, pricePer1kInput = 0, pricePer1kOutput = 0 } = {}) {
  return (inputTokens / 1000) * pricePer1kInput + (outputTokens / 1000) * pricePer1kOutput;
}
