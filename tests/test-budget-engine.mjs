// M61 RED: cost/token budget engine — kontrol biaya real-time.
import {
  createBudget, trackUsage, isOverBudget, getBudgetReport,
  BUDGET_KIND, estimateCost,
} from '../src/budget-engine.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] createBudget ────────────────────────────────────────────────────────
{
  const b = createBudget({ maxTokens: 100000, maxCostUsd: 5.0, maxProviderCalls: 50 });
  check('create: maxTokens', b.limits.maxTokens === 100000);
  check('create: maxCostUsd', b.limits.maxCostUsd === 5.0);
  check('create: maxProviderCalls', b.limits.maxProviderCalls === 50);
  check('create: usage mulai dari 0', b.usage.totalTokens === 0 && b.usage.totalCostUsd === 0);
}

// ── [2] trackUsage ──────────────────────────────────────────────────────────
{
  const b = createBudget({ maxTokens: 1000, maxCostUsd: 1.0, maxProviderCalls: 10 });
  trackUsage(b, { tokens: 200, costUsd: 0.1, providerCalls: 1 });
  check('track: tokens terakumulasi', b.usage.totalTokens === 200);
  check('track: cost terakumulasi', Math.abs(b.usage.totalCostUsd - 0.1) < 0.001);
  check('track: calls terakumulasi', b.usage.providerCalls === 1);

  trackUsage(b, { tokens: 300, costUsd: 0.2, providerCalls: 2 });
  check('track: akumulasi benar', b.usage.totalTokens === 500 && b.usage.providerCalls === 3);
}

// ── [3] isOverBudget ────────────────────────────────────────────────────────
{
  const b = createBudget({ maxTokens: 1000, maxCostUsd: 1.0, maxProviderCalls: 10 });
  check('over: belum', isOverBudget(b) === false);
  trackUsage(b, { tokens: 500, costUsd: 0.5, providerCalls: 5 });
  check('over: belum (setengah)', isOverBudget(b) === false);
  trackUsage(b, { tokens: 600, costUsd: 0.6, providerCalls: 6 });
  check('over: token melebihi', isOverBudget(b) === true);
}
{
  const b = createBudget({ maxTokens: 10000, maxCostUsd: 0.5, maxProviderCalls: 100 });
  trackUsage(b, { tokens: 100, costUsd: 1.0, providerCalls: 1 });
  check('over: cost melebihi', isOverBudget(b) === true);
}
{
  const b = createBudget({ maxTokens: 10000, maxCostUsd: 100, maxProviderCalls: 3 });
  trackUsage(b, { tokens: 100, costUsd: 0.1, providerCalls: 3 });
  check('over: calls melebihi', isOverBudget(b) === true);
}

// ── [4] getBudgetReport ─────────────────────────────────────────────────────
{
  const b = createBudget({ maxTokens: 1000, maxCostUsd: 1.0, maxProviderCalls: 10 });
  trackUsage(b, { tokens: 500, costUsd: 0.5, providerCalls: 5 });
  const report = getBudgetReport(b);
  check('report: ada tokens', /500.*1000|50%/.test(report));
  check('report: ada cost', /\$0\.5/.test(report));
  check('report: ada calls', /5.*10/.test(report));
}

// ── [5] estimateCost ────────────────────────────────────────────────────────
{
  const cost = estimateCost({ inputTokens: 1000, outputTokens: 500, pricePer1kInput: 0.001, pricePer1kOutput: 0.002 });
  check('estimate: hitungan benar', Math.abs(cost - (1000/1000*0.001 + 500/1000*0.002)) < 0.001);
  check('estimate: tanpa data -> 0', estimateCost({}) === 0);
}

// ── [6] BUDGET_KIND ─────────────────────────────────────────────────────────
{
  check('kind: TOKENS ada', BUDGET_KIND.TOKENS === 'tokens');
  check('kind: COST ada', BUDGET_KIND.COST === 'cost');
  check('kind: CALLS ada', BUDGET_KIND.CALLS === 'calls');
}

// ── [7] Robustness ──────────────────────────────────────────────────────────
{
  check('create: tanpa limit tidak crash', typeof createBudget({}) === 'object');
  check('track: null budget tidak crash', (() => { try { trackUsage(null, {}); return true; } catch { return false; } })());
  check('over: null budget -> false', isOverBudget(null) === false);
  check('report: null budget -> string', typeof getBudgetReport(null) === 'string');
}

console.log(`\n=== HASIL BUDGET-ENGINE: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
