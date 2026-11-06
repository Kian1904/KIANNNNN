import { decideRecovery, buildRecoveryHint } from '../../optional/recovery.js';

export function decideBashRecovery(input, deps = {}) {
  return (deps.decideRecovery || decideRecovery)(input);
}

export function recoveryHint(input, deps = {}) {
  return (deps.buildRecoveryHint || buildRecoveryHint)(input);
}
