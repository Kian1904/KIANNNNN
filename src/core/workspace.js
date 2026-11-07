import fs from 'node:fs';
import path from 'node:path';

let workspaceRoot = path.resolve(process.env.KIAN_WORKSPACE || process.cwd());

export function setWorkspaceRoot(root) {
  if (!root) return workspaceRoot;
  workspaceRoot = path.resolve(root);
  return workspaceRoot;
}

export function getWorkspaceRoot() { return workspaceRoot; }

export function resolveWorkspacePath(target = '.') {
  return path.resolve(workspaceRoot, target || '.');
}

/** Find a workspace from cwd without silently selecting the installed CLI repo. */
export function discoverWorkspaceRoot(start = process.cwd()) {
  if (process.env.KIAN_WORKSPACE) return setWorkspaceRoot(process.env.KIAN_WORKSPACE);
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, 'AGENT.md')) || fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, 'package.json'))) {
      return setWorkspaceRoot(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return setWorkspaceRoot(start);
}
