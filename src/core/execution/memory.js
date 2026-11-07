import { saveDecision } from '../../db.js';

export function executeRemember(key, value, context, deps = {}) {
  const save = deps.saveDecision || saveDecision;
  save({ key, value, context });
  return { key, value };
}
