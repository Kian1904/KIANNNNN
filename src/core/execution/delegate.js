import { delegateTask } from '../../optional/delegation.js';

export async function executeDelegate(agent, task, options = {}, deps = {}) {
  return (deps.delegateTask || delegateTask)(agent, task, options);
}
