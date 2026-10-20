import { SYSTEM_PROMPT } from './prompts/system.js';

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:plan]', ...args); };

/** Bikin Error yang nempel balasan mentah model, biar retry bisa nunjukin ke model. */
function stepError(msg, raw) {
  const e = new Error(raw === undefined ? msg : `${msg}\n`, raw);
  e.raw = raw;
  return e;
}


/**
 * Bungkus planStep biar SATU balasan sampah dari model gak matiin seluruh task.
 *
 * Kenapa ini penting: provider gratis kadang balas teks biasa ("Oke, aku bantu
 * kamu...") atau formatnya setengah jadi. planStep() throw di kasus itu — dan
 * yang lama, throw-nya nyebar keluar runTask sampai gak ada yang nangkap sama
 * sekali. Hasilnya: task mati di langkah pertama, semua progress hilang, cuma
 * demi satu balasan jelek.
 *
 * Di sini tiap percobaan yang gagal dikirim ulang ke model BESERTA kesalahannya,
 * jadi model dapat kesempatan kedua (dan ketiga). Ini "self-correcting" yang
 * beneran: bukan nyembunyiin error, tapi minta model benerin.
 *
 * @param {Function} askFn
 * @param {Object} ctx - argumen buat planStep
 * @param {{maxAttempts?:number, onRetry?:Function}} [opts]
 * @returns {Promise<{ok:true, step:Object, attempts:number} | {ok:false, lastError:string, attempts:number, raw:string|null}>}
 *   Selalu resolve — TIDAK pernah throw. Pemanggil tinggal cek ok.
 */
export async function planStepWithRetry(askFn, ctx, { maxAttempts = 3, onRetry } = {}) {
  let lastError = null;
  let lastRaw = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const step = await planStep(askFn, ctx);
      return { ok: true, step, attempts: attempt };
    } catch (err) {
      lastError = err.message;
      lastRaw = err.raw !== undefined ? err.raw : null;
      dbg(`planStep gagal (percobaan ${attempt}/${maxAttempts}):`, err.message.slice(0, 200));

      if (attempt === maxAttempts) break;
      if (onRetry) {
        try { onRetry(attempt, maxAttempts, err.message); } catch { /* onRetry gak boleh matiin retry */ }
      }

      // Kasih tau model APA yang salah dan gimana yang bener. Tanpa ini,
      // percobaan kedua cuma ngulang kesalahan yang sama.
      const prev = lastRaw ? `\n\nBALASAN KAMU TADI:\n${String(lastRaw).slice(0, 400)}` : '';
      ctx = {
        ...ctx,
        systemPromptOverride: [
          ctx.systemPromptOverride || '',
          `\n\n[SISTEM: Balasan sebelumnya GAGAL diparse. MASALAHNYA: ${lastError.split('\n')[0]}`,
          'Kamu WAJIB balas dengan format yang bener, mulai dengan baris REASONING: lalu ACTION: (satu dari: read, list_dir, edit, delete, rename, move, bash, web_search, mcp_call, remember, chat, done).',
          'JANGAN balas dengan kalimat pembuka, penjelasan, atau markdown. Langsung formatnya.' + prev + ']',
        ].join(''),
      };
    }
  }

  return { ok: false, lastError, attempts: maxAttempts, raw: lastRaw };
}

export function buildHistoryText(history) {
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
    if (h.action === 'delete' || h.action === 'rename' || h.action === 'move') {
      const dest = h.dest ? ` → ${h.dest}` : '';
      return `Langkah ${i + 1}: ${h.action.toUpperCase()} ${h.target}${dest} — ${h.approved ? 'diterapkan' : 'DITOLAK user'}`;
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
    if (h.action === 'web_search') {
      const truncated = h.summary.length > 800 ? `${h.summary.slice(0, 800)}... [truncated]` : h.summary;
      return `Langkah ${i + 1}: WEB_SEARCH "${h.query}" (via ${h.provider || 'gagal'}) — hasil:\n${truncated}`;
    }
    const stderrPart = h.result.stderr ? `, stderr: ${h.result.stderr.slice(0, 500)}` : '';
    return `Langkah ${i + 1}: BASH "${h.command}" — exit ${h.result.code}, stdout: ${h.result.stdout.slice(0, 300)}${stderrPart}`;
  }).join('\n');
}

export async function planStep(askFn, { instruction, fileSnapshot, history, agentMd, recentMemory, availableTools, webSearchCount, systemPromptOverride }) {
  // systemPromptOverride dipakai oleh agent ber-role (lihat src/agents.js) untuk
  // mengganti prompt generik dengan prompt spesifik role + pembatasan aksi.
  const systemPrompt = systemPromptOverride
    || (agentMd
      ? `${SYSTEM_PROMPT}\n\n## Project Instructions (AGENT.md)\n${agentMd}`
      : SYSTEM_PROMPT);

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
  const searchLimitWarning = (webSearchCount && webSearchCount >= 2)
    ? `\nPERINGATAN: Kamu sudah melakukan ${webSearchCount} kali web_search. Maksimal 2 kali. JANGAN pilih ACTION: web_search lagi. Pilih ACTION: done atau action lain.\n`
    : '';
  const userPrompt = `Task: ${instruction}: ${toolsText ? `\nMCP Tools yang tersedia:\n${toolsText}\n` : ''}


 Isi file saat ini (kalau relevan):
   ---
   ${fileSnapshot}
   ---

 Memory dari sesi sebelumnya:
   ${memoryText}

History langkah sebelumnya di task ini:
   ${buildHistoryText(history)}
${searchLimitWarning}
Kerjakan task tersebut sekarang — langsung pilih ACTION yang paling logis.`;

      dbg('userPrompt preview:', userPrompt.slice(0, 300) + '...');
  let raw = await askFn(systemPrompt, userPrompt);
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const reasoningMatch = raw.match(/REASONING:\s*(.*)/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : '';
  const actionMatch = raw.match(/ACTION:\s*(edit|bash|done|read|list_dir|remember|mcp_call|web_search|chat|delete|rename|move)/);
       dbg('raw LLM response:', raw.slice(0, 500) + (raw.length > 500 ? '...[truncated]' : ''));

  if (!actionMatch) {
    throw stepError(`Respons LLM tidak punya ACTION yang valid.\n`, raw);
  }
  const action = actionMatch[1];
 
  if (action === 'done') {
    const summaryMatch = raw.match(/SUMMARY:\s*(.*)/);
    return { action, reasoning, summary: summaryMatch ? summaryMatch[1].trim() : '' };
  }

  if (action === 'bash') {
    const commandMatch = raw.match(/COMMAND:\s*(.*)/);
    if (!commandMatch) throw stepError(`ACTION bash tapi tidak ada COMMAND.\n`, raw);
    return { action, reasoning, command: commandMatch[1].trim() };
  }

  if (action === 'read') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    if (!targetMatch) throw stepError(`ACTION read tapi tidak ada TARGET.\n`, raw);
    const offsetMatch = raw.match(/OFFSET:\s*(-?\d+)/);
    const limitMatch = raw.match(/LIMIT:\s*(-?\d+)/);
    const step = { action, reasoning, target: targetMatch[1].trim() };
    // Nilai gak masuk akal (negatif / nol) DIBUANG, bukan dipaksa jadi angka
    // aneh — biar readFileRange pakai default-nya sendiri. Batas atas 2000
    // baris biar satu halaman gak pernah membanjiri konteks.
    const offsetRaw = offsetMatch ? Number(offsetMatch[1]) : NaN;
    const limitRaw = limitMatch ? Number(limitMatch[1]) : NaN;
    if (Number.isFinite(offsetRaw) && offsetRaw > 0) step.offset = offsetRaw;
    if (Number.isFinite(limitRaw) && limitRaw > 0) step.limit = Math.min(limitRaw, 2000);
    return step;
  }

  if (action === 'list_dir') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    return { action, reasoning, target: targetMatch ? targetMatch[1].trim() : '.' };
  }

  // Aksi destruktif. DEST cuma dipakai rename/move — kalau gak ada, throw
  // sekarang (murah) daripada nanti pas udah mau eksekusi.
  if (action === 'delete' || action === 'rename' || action === 'move') {
    const targetMatch = raw.match(/TARGET:\s*(.*)/);
    if (!targetMatch) throw stepError(`ACTION ${action} tapi tidak ada TARGET.\n`, raw);
    const step = { action, reasoning, target: targetMatch[1].trim() };
    if (action !== 'delete') {
      const destMatch = raw.match(/DEST:\s*(.*)/);
      if (!destMatch) throw stepError(`ACTION ${action} butuh DEST (tujuan).\n`, raw);
      step.dest = destMatch[1].trim();
    }
    return step;
  }

  if (action === 'remember') {
    const keyMatch = raw.match(/KEY:\s*(.*)/);
    const valueMatch = raw.match(/VALUE:\s*(.*)/);
  if (!keyMatch || !valueMatch) throw stepError(`ACTION remember tapi KEY/VALUE tidak lengkap.\n`, raw);
    return { action, reasoning, key: keyMatch[1].trim(), value: valueMatch[1].trim() };
  }
  
  if (action === 'mcp_call') {
  const toolMatch = raw.match(/TOOL:\s*(.*)/);
  const paramsMatch = raw.match(/PARAMS:\s*(\{[\s\S]*\})/);
  if (!toolMatch) throw stepError(`ACTION mcp_call tapi tidak ada TOOL.\n`, raw);
  let toolArgs = {};
  if (paramsMatch) {
    try { toolArgs = JSON.parse(paramsMatch[1].trim()); }
    catch (e) { throw stepError(`PARAMS bukan JSON valid: ${paramsMatch[1]}`); }
  }
  return { action, reasoning, tool: toolMatch[1].trim(), toolArgs };
}

  if (action === 'web_search') {
    const queryMatch = raw.match(/QUERY:\s*(.*)/);
    if (!queryMatch) throw stepError(`ACTION web_search tapi tidak ada QUERY.\n`, raw);
    return { action, reasoning, query: queryMatch[1].trim() };
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
    throw stepError(`ACTION edit tapi format TARGET/CONTENT tidak lengkap.\n`, raw);
  }
  const newContent = raw
    .slice(startIdx + '===CONTENT_START==='.length, endIdx)
    .replace(/^\n/, '')
    .replace(/\n$/, '');

  return { action, reasoning, target: targetMatch[1].trim(), new_content: newContent };
}
