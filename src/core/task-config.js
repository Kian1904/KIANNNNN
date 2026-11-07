import { composeAgentPrompt, filterToolsForAgent } from '../agents.js';
import { createTaskBudget } from '../task-budget.js';
import { readEnv } from '../env.js';
import { renderContract } from '../task-contract.js';

const DEFAULT_MAX_LOOPS = 25;

/**
 * Build immutable-ish runtime configuration for one task.
 * No model calls, filesystem writes, or UI side effects happen here.
 */
export function createTaskRuntimeConfig({
  agentConfig = null,
  agentMd = null,
  availableTools = [],
  contract = { acceptance: [], risk: 'low' },
  env = process.env,
} = {}) {
  const maxLoops = (agentConfig && agentConfig.maxLoops) || Number.parseInt(env.MAX_LOOPS, 10) || DEFAULT_MAX_LOOPS;
  const toolsForAgent = agentConfig
    ? filterToolsForAgent(availableTools, agentConfig.mcpTools)
    : availableTools;
  const allowedActions = agentConfig ? agentConfig.actions : null;
  let systemPromptOverride = agentConfig ? composeAgentPrompt(agentConfig, agentMd) : null;

  if (contract.acceptance.length > 0) {
    const contractBlock = `\n\n## KONTRAK TASK (WAJIB DIPENUHI)\n${renderContract(contract)}\n\nACTION: done HANYA diterima kalau semua acceptance criteria di atas punya bukti aktual.\nKalau ada kriteria yang belum bisa dibuktikan, jangan pilih done — lakukan aksi yang membuktikannya.`;
    systemPromptOverride = `${systemPromptOverride || ''}${contractBlock}`;
  }

  const budget = createTaskBudget({
    maxSteps: maxLoops,
    maxSearches: Number.parseInt(env.MAX_SEARCH, 10) || 2,
    maxFetches: Number.parseInt(env.MAX_FETCH, 10) || 3,
    maxProviderCalls: env.MAX_LOOPS ? Math.min(maxLoops * 3, 30) : 15,
  });

  return { maxLoops, toolsForAgent, allowedActions, systemPromptOverride, budget };
}
