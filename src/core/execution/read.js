import { readFileRange, listDirSafe } from '../../utils/fs.js';
import { formatReadResult, normalizeListTarget } from '../fs-actions.js';

export function executeRead(target, offset = 1, limit = 400, deps = {}) {
  const read = deps.readFileRange || readFileRange;
  const result = read(target, offset, limit);
  return { result, ...formatReadResult(target, result) };
}

export function executeListDir(target, deps = {}) {
  const dir = normalizeListTarget(target);
  const list = deps.listDirSafe || listDirSafe;
  return { target: dir, listing: list(dir) };
}
