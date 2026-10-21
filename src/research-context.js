// M41: compact context handoff — raw evidence ke summary pendek buat LLM.
import { focusWebText } from './web-fetch.js';

export function compactResearchContext(packet, { maxChars = 2000 } = {}) {
  if (!packet || !packet.facts || packet.facts.length === 0) return '(tidak ada data riset)';
  const lines = packet.facts.map(f => `${f.key}: ${f.value}${f.unit ? ' ' + f.unit : ''} (${f.source})`);
  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;
  const focused = focusWebText(joined, packet.topic || '');
  return focused.slice(0, maxChars);
}
