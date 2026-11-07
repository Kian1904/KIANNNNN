import { applySafeFileOp, applyFileOp, lintAfterWrite } from '../../file-ops.js';

export function executeSafeMutation(action, target, content, deps = {}) {
  return (deps.applySafeFileOp || applySafeFileOp)(action, target, content);
}

export function executeDestructive(action, target, dest, deps = {}) {
  return (deps.applyFileOp || applyFileOp)(action, target, dest);
}

export function lintWrittenFile(target, previousContent, deps = {}) {
  return (deps.lintAfterWrite || lintAfterWrite)(target, previousContent);
}
