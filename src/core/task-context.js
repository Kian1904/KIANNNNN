import { buildTaskContract } from '../task-contract.js';
import { TASK_STATUS, createJournal, appendEntry } from '../task-journal.js';
import { setWorkspaceRoot, getWorkspaceRoot } from './workspace.js';

/**
 * Create the state shared by one single-agent task.
 * This boundary owns history, contract, and optional journal persistence.
 */
export function createTaskContext({
  instruction = '',
  agentConfig = null,
  threadId = null,
  journalEnabled = true,
  journalDir,
  cwd = process.cwd(),
  taskId = `t-${Date.now()}-${process.pid}`,
  workspaceRoot,
} = {}) {
  if (workspaceRoot) setWorkspaceRoot(workspaceRoot);
  const history = [];
  const contract = agentConfig && agentConfig.contractEnabled === false
    ? { goal: '', constraints: [], acceptance: [], risk: 'low', instruction: '' }
    : buildTaskContract(instruction);

  let journal = null;
  if (journalEnabled) {
    try {
      journal = createJournal({
        ...(journalDir ? { dir: journalDir } : {}),
        taskId,
        goal: instruction,
        status: TASK_STATUS.RUNNING,
        meta: {
          agent: agentConfig?.name || 'generic',
          cwd,
          threadId: threadId ?? null,
          risk: contract.risk,
        },
      });
    } catch {
      journal = null;
    }
  }

  const journalLog = (entry) => {
    if (!journal) return null;
    try { return appendEntry(journal, entry); } catch { return null; }
  };

  const pushHistory = (item) => {
    history.push(item);
    if (item && typeof item === 'object') {
      journalLog({
        type: 'action',
        action: item.action,
        target: item.target,
        command: item.command,
        verified: item.verified === true,
        error: item.error,
        approved: item.approved,
      });
    }
    return item;
  };

  return { history, contract, journal, journalLog, pushHistory };
}
