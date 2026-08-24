import { SYSTEM_PROMPT } from '.prompts/system.js';

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:plan]', ...args); };

function buildHistoryText(history) {
  if (history.length === 0) return '(belum ada langkah)';
  return history.map((h, i) => {
    if (h.action === 'read') {
      return `Langkah ${i + 1}: READ ${h.target}\n--- ISI FILE ---\n${h.content}\n--- END ---`;
    }
    if (h.action === 'list_dir') {
      return `Langkah ${i + 1}: LIST_DIR ${h.target}\n${h.listing}`;
    }
    if (h.action === 'chat') {
      return `Langkah ${i + 1}: CHAT — "${h.reply.slice(0, 80)}${h.reply.length > 80 ? '...' : ''}"`;
    }
    if (h.action === 'edit') {
      return `Langkah ${i + 1}: EDIT ${h.target} — ${h.approved ? 'diterapkan' : 'DITOLAK user'}`;
    }
    if (!h.approved) {
      return `Langkah ${i + 1}: BASH "${h.command}" — DITOLAK user`;
    }
    if (h.action === 'remember') {
      return `Langkah ${i + 1}: REMEMBER ${h.key} = "${h.value}"`;
    }
    if (h.action === 'user_condition') {
      return `Langkah ${i + 1}: [USER CONDITION] "${h.condition}" — agent wajib mempertimbangkan ini`;
    }
    if (h.action === 'mcp_call') {
      const truncated = h.result.length > 500 ? `${h.result.slice(0, 500)}... [truncated]` : h.result;
      return `Langkah ${i + 1}: MCP_CALL ${h.tool} — hasil:\n${truncated}`;
    }
    const stderrPart = h.result.stderr ? `, stderr: ${h.result.stderr.slice(0, 500)}` : '';
    return `Langkah ${i + 1}: BASH "${h.command}" — exit ${h.result.code}, stdout: ${h.result.stdout.slice(0, 300)}${stderrPart}`;
  }).join('\n');
}

export async function planStep(askFn, { instruction, fileSnapshot, history, agentMd, recentMemory, availableTools }) {
  const systemPrompt = agentMd
    ? `${SYSTEM_PROMPT}\n\n## Project Instructions (AGENT.md)\n${agentMd}`
    : SYSTEM_PROMPT;

  const memoryText = recentMemory && recentMemory.length > 0
  ? recentMemory.map(m => `- [${m.key}]: ${m.value}`).join('\n')
  : '(belum ada memory tersimpan)';
  const toolsText = availableTools && availableTools.length > 0
  ? availableTools.map(t => {
      let line = `- ${t.name}: ${t.description}`;
      if (t.inputSchema && t.inputSchema.properties) {
        const params = Object.entries(t.inputSchema.properties).map(([k, v]) => {
          const req = (t.inputSchema.required || []).includes(k) ? ' (wajib)' : '';
          return `${k}${req}: ${v.description || v.type || ''}`;
        }).join(', ');
        if (params) line += ` | PARAMS: {${params}}`;
      }
      return line;
    }).join('\n')
  : null;
  const userPrompt = `Task: ${instruction}: ${toolsText ? `\nMCP Tools yang tersedia:\n${toolsText}\n` : ''}
  

 Isi file saat ini (kalau relevan):
   ---
   ${fileSnapshot}
   ---

 Memory dari sesi sebelumnya:
   ${memoryText}

History langkah sebelumnya di task ini:
   ${buildHistoryText(history)}
  
Kerjakan task tersebut sekarang — langsung pilih ACTION yang paling logis.`;

      dbg('userPrompt preview:', userPrompt.slice(0, 300) + '...');
  let raw = await askFn(systemPrompt, userPrompt);
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const reasoningMatch = raw.match(/REASONING:\s*(.*)/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : '';
  const actionMatch = raw.match(/ACTION:\s*(edit|bash|done|read|list_dir|remember|mcp_call|chat)/);
       dbg('raw LLM response:', raw.slice(0, 500) + (raw.length > 500 ? '...[truncated]' : ''));

  if (!actionMatch) {
    throw new Error(`Respons LLM tidak punya ACTION yang valid.\n--- raw ---\n${raw}`);
  }
  const action = actionMatch[1];
 
  if (action === 'done') {
    const summaryMatch = raw.match(/SUMMARY:\s*(.*)/);
    return { action, reasoning, summary: summaryMatch ? summaryMatch[1].trim() : '' };
  }

  if (action === 'bash') {
    const commandMatch = raw.match(/COMMAND:\s*(.*)/);
    if (!commandMatch) throw new Error(`ACTION bash tapi tidak ada COMMAND.\n--- raw ---\n${raw}`);
    return { action, reasoning, command: commandMatch[1].trim() };
  }

  if (action === 'read') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    if (!targetMatch) throw new Error(`ACTION read tapi tidak ada TARGET.\n--- raw ---\n${raw}`);
    return { action, reasoning, target: targetMatch[1].trim() };
  }

  if (action === 'list_dir') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    return { action, reasoning, target: targetMatch ? targetMatch[1].trim() : '.' };
  }

  if (action === 'remember') {
    const keyMatch = raw.match(/KEY:\s*(.*)/);
    const valueMatch = raw.match(/VALUE:\s*(.*)/);
  if (!keyMatch || !valueMatch) throw new Error(`ACTION remember tapi KEY/VALUE tidak lengkap.\n--- raw ---\n${raw}`);
    return { action, reasoning, key: keyMatch[1].trim(), value: valueMatch[1].trim() };
  }
  
  if (action === 'mcp_call') {
  const toolMatch = raw.match(/TOOL:\s*(.*)/);
  const paramsMatch = raw.match(/PARAMS:\s*(\{[\s\S]*\})/);
  if (!toolMatch) throw new Error(`ACTION mcp_call tapi tidak ada TOOL.\n--- raw ---\n${raw}`);
  let toolArgs = {};
  if (paramsMatch) {
    try { toolArgs = JSON.parse(paramsMatch[1].trim()); }
    catch (e) { throw new Error(`PARAMS bukan JSON valid: ${paramsMatch[1]}`); }
  }
  return { action, reasoning, tool: toolMatch[1].trim(), toolArgs };
}

  if (action === 'chat') {
    const replyMatch = raw.match(/REPLY:\s*([\s\S]*)/);
    return { action, reasoning, reply: replyMatch ? replyMatch[1].trim() : '' };
  }

  // action === 'edit'
  const targetMatch = raw.match(/TARGET:\s*(.*)/);
  const startIdx = raw.indexOf('===CONTENT_START===');
  const endIdx = raw.indexOf('===CONTENT_END===');
  if (!targetMatch || startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`ACTION edit tapi format TARGET/CONTENT tidak lengkap.\n--- raw ---\n${raw}`);
  }
  const newContent = raw
    .slice(startIdx + '===CONTENT_START==='.length, endIdx)
    .replace(/^\n/, '')
    .replace(/\n$/, '');

  return { action, reasoning, target: targetMatch[1].trim(), new_content: newContent };
}
