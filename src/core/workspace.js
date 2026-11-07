import path from 'node:path';

let workspaceRoot = path.resolve(process.env.KIAN_WORKSPACE || process.cwd());

export function setWorkspaceRoot(root) {
  if (!root) return workspaceRoot;
  workspaceRoot = path.resolve(root);
  return workspaceRoot;
}

export function getWorkspaceRoot() { return workspaceRoot; }

export function resolveWorkspacePath(target = '.') {
  return path.resolve(workspaceRoot, target);
}
