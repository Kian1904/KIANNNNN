// src/run-task.js — Handler loop agen otonom (ReAct)

import fs from 'fs';
import { askWithFallback, fallbackState } from './providers.js';
import { planStep } from './plan.js';
import { showDiff } from './diff.js';
import { runCommand } from './bash.js';
import { logStep, saveDecision, getRecentDecisions, saveSnapshot } from './db.js';
import { callTool } from '../mcp/client.js';
import { searchWeb } from './search.js';
import { print, printBlock, sep, blank } from './ui.js';
import { readFileSafe, listDirSafe } from './utils/fs.js';

// M12 — Extended MAX_LOOPS
const MAX_LOOPS = parseInt(process.env.MAX_LOOPS) || 25;

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:task]', ...args); };

/**
 * Jalankan agentic otonom loop
 * @param {string} instruction
 * @param {string|null} agentMd
 * @param {Array} availableTools
 * @param {number|null} threadId
 * @param {Object} stats
 * @param {Function} trackProvider
 * @param {Function} trackAction
 * @param {Function} isDangerous
 * @param {Function} askApproval
 */
export async function runTask(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval) {
  if (stats) stats.tasks++;
  const history = [];
  let lastTarget = null;
  const recentMemory = getRecentDecisions(5);
  let webSearchCount = 0;

  dbg('=== Task Start ===');
  dbg('Instruction:', instruction);
  dbg('agentMd:', agentMd ? `loaded (${agentMd.length} chars)` : 'not found');
  dbg('recentMemory:', recentMemory.length, 'entries');
  dbg('availableTools:', availableTools?.map(t => t.name) || []);

  for (let i = 1; i <= MAX_LOOPS; i++) {
    const fileSnapshot = readFileSafe(lastTarget);
    dbg(`--- Loop ${i} ---`);
    dbg('fileSnapshot:', fileSnapshot.slice(0, 100) + (fileSnapshot.length > 100 ? '...' : ''));

    const step = await planStep(askWithFallback, { instruction, fileSnapshot, history, agentMd, recentMemory, availableTools, webSearchCount });
    
    if (trackProvider) trackProvider(fallbackState.lastProvider);
    if (trackAction) trackAction(step.action);

    dbg('Parsed step:', JSON.stringify({ action: step.action, target: step.target, tool: step.tool }).replace(/undefined/g, '-'));

    // --- DONE ---
    if (step.action === 'done') {
      print('done', step.summary);
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: step.summary, actionType: 'done', reasoning: step.reasoning, approved: true });
      } else {
        logStep({ task: instruction, actionType: 'done', detail: null, reasoning: step.reasoning, approved: true });
      }
      blank();
      return;
    }

    // --- CHAT (no step header, no ceremony) ---
    if (step.action === 'chat') {
      blank();
      printBlock(step.reply);
      blank();
      history.push({ action: 'chat', reply: step.reply });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: step.reply, actionType: 'chat', reasoning: step.reasoning });
      }
      continue;
    }

    // Untuk semua action teknis — baru tampilkan header
    blank();
    sep();
    print('step', `${i} / ${MAX_LOOPS}`);
    sep();
    print('provider', fallbackState.lastProvider);
    print('reasoning', step.reasoning);

    // --- READ ---
    if (step.action === 'read') {
      const content = readFileSafe(step.target);
      const preview = content.length > 2000
        ? content.slice(0, 2000) + '\n[...TRUNCATED]'
        : content;
      print('read', step.target);
      printBlock(preview);
      history.push({ action: 'read', target: step.target, content: preview });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Read file: ${step.target}\n${preview}`, actionType: 'read', reasoning: step.reasoning });
      }
      continue;
    }

    // --- LIST_DIR ---
    if (step.action === 'list_dir') {
      const listing = listDirSafe(step.target);
      const dir = (step.target || '.').trim();
      print('list_dir', dir);
      printBlock(listing);
      history.push({ action: 'list_dir', target: dir, listing });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Listed directory: ${dir}\n${listing}`, actionType: 'list_dir', reasoning: step.reasoning });
      }
      continue;
    }

    // --- REMEMBER ---
    if (step.action === 'remember') {
      saveDecision({ key: step.key, value: step.value, context: instruction });
      print('remember', `${step.key}: ${step.value}`);
      history.push({ action: 'remember', key: step.key, value: step.value });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Remembered: ${step.key} = ${step.value}`, actionType: 'remember', reasoning: step.reasoning });
      }
      continue;
    }

    // --- MCP_CALL ---
    if (step.action === 'mcp_call') {
      print('mcp', `Memanggil tool: ${step.tool}`);
      try {
        const result = await callTool(step.tool, step.toolArgs, availableTools);
        print('mcp', 'Hasil:');
        printBlock(result.slice(0, 2500) + (result.length > 500 ? '...' : ''));
        history.push({ action: 'mcp_call', tool: step.tool, result });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Called tool: ${step.tool}\nResult: ${result.slice(0, 500)}${result.length > 500 ? '...' : ''}`, actionType: 'mcp_call', detail: { tool: step.tool, result }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('mcp_err', err.message);
        history.push({ action: 'mcp_call', tool: step.tool, result: `ERROR: ${err.message}` });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Tool error: ${step.tool}\nError: ${err.message}`, actionType: 'mcp_call', detail: { tool: step.tool, error: err.message }, reasoning: step.reasoning });
        }
      }
      // Auto-done jika task hanya satu mcp_call dan tidak ada kata lanjutan
      const continueWords = /(lanjut|terus|setelah|kemudian|lalu|selanjutnya)/i;
      if (history.length === 1 && !continueWords.test(instruction)) {
        print('done', 'Task selesai dengan mcp_call.');
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: 'Task selesai dengan mcp_call.', actionType: 'done', reasoning: 'Auto-done after mcp_call', approved: true });
        } else {
          logStep({ task: instruction, actionType: 'done', detail: null, reasoning: 'Auto-done after mcp_call', approved: true });
        }
        blank();
        return;
      }
      continue;
    }

    // --- WEB_SEARCH ---
    if (step.action === 'web_search') {
      webSearchCount++;
      if (webSearchCount > 2) {
        print('info', 'Batas 2x web_search tercapai - memaksa rangkuman dari data yang ada.');
        const forcedInstruction = `${instruction}\n\n[SISTEM: Kamu sudah mencapao batas maksimal pencarian web. WAJIB ACTION: done sekarang. Tulis SUMMARY dari hasil search yang sudah ada di history dengan kata-katamu sendiri. DILARANG ACTION: web_search atau ACTION: mcp_call apapun di langkah inj.]`;
        const forcedStep = await planStep(askWithFallback, { instruction: forcedInstruction, fileSnapshot, history, agentMd, recentMemory, availableTools, webSearchCount });
        if (forcedStep.action === 'done') {
          print('done', forcedStep.summary);
          if (threadId) {
            logStep({ threadId, role: 'assistant', content: forcedStep.summary, actionType: 'done', reasoning: forcedStep.reasoning });
          }
        }
        else {
          const searchSummaries = history.filter(h => h.action === 'web_search').map(h => h.summary).join('\n\n---\n\n');
          print('done', `Task selesai (dipaksa, LLM tidak patuh instruksi done). Data yang terkumpul:\n\n${searchSummaries.slice(0, 1500)}`);
        }
      }
      blank();
      return;
    }
      print('web_search', step.query);
      try {
        const { provider, results } = await searchWeb(step.query);
        print('sources', results.length ? results.map(r => r.url).join('\n') : '(tidak ada hasil)');
        const summary = results
          .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n');
        history.push({ action: 'web_search', query: step.query, provider, summary: summary || '(tidak ada hasil)' });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Searched: ${step.query}\nSources: ${results.map(r => r.url).join(', ')}`, actionType: 'web_search', detail: { query: step.query, provider, sources: results.map(r => r.url) }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('search_err', err.message);
        history.push({ action: 'web_search', query: step.query, provider: null, summary: `ERROR: ${err.message}` });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Search error: ${step.query}\nError: ${err.message}`, actionType: 'web_search', detail: { query: step.query, error: err.message }, reasoning: step.reasoning });
        }
      }
      continue;
    }

    // --- EDIT ---
    if (step.action === 'edit') {
      const current = readFileSafe(step.target);
      print('diff', step.target);
      printBlock(showDiff(current === '(file tidak ditemukan)' || current.startsWith('(ACCESS DENIED') ? '' : current, step.new_content));
      sep();

      const editApproval = await askApproval('edit');
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Edit requested: ${step.target}`, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });
      } else {
        logStep({ task: instruction, actionType: 'edit', detail: { target: step.target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });
      }

      if (!editApproval.approved) {
        print('rejected', 'Langkah dibatalkan, task dihentikan.');
        return;
      }
      if (editApproval.condition) {
        history.push({ action: 'user_condition', condition: editApproval.condition });
      }

      const existingContent = readFileSafe(step.target);
      if (existingContent !== '(file tidak ditemukan)' && !existingContent.startsWith('(ACCESS DENIED')) {
        saveSnapshot({ filepath: step.target, content: existingContent });
        print('snapshot', `${step.target} disimpan.`);
      }

      fs.writeFileSync(step.target, step.new_content, 'utf8');
      print('edit_ok', `${step.target} diupdate.`);
      lastTarget = step.target;
      history.push({ action: 'edit', target: step.target, approved: true });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `File edited: ${step.target}`, actionType: 'edit', detail: { target: step.target, applied: true }, reasoning: step.reasoning });
      }
      continue;
    }

    // --- BASH ---
    if (step.action === 'bash') {
      print('bash', step.command);

      const { checkPackageSafety } = await import('./package-safety.js');
      const safety = await checkPackageSafety(step.command);

      if (safety) {
        print('safety', '');
        safety.flags.forEach(f => printBlock(f));
        if (safety.blocked) {
          print('blocked', 'Command diblokir otomatis karena alasan keamanan.');
          if (threadId) {
            logStep({ threadId, role: 'assistant', content: `Command blocked: ${step.command}`, actionType: 'bash', detail: { command: step.command, blocked: true }, reasoning: step.reasoning, approved: false });
          } else {
            logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, blocked: true }, reasoning: step.reasoning, approved: false });
          }
          print('rejected', 'Command dibatalkan, task dihentikan.');
          return;
        }
      }

      const dangerous = isDangerous(step.command);
      const bashApproval = await askApproval('bash', { forceAsk: dangerous });

      if (!bashApproval.approved) {
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Command denied: ${step.command}`, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        } else {
          logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: false });
        }
        print('rejected', 'Command dibatalkan, task dihentikan.');
        return;
      }
      if (bashApproval.condition) {
        history.push({ action: 'user_condition', condition: bashApproval.condition });
      }

      const result = await runCommand(step.command);
      print('exit_code', `${result.code}  stdout: ${result.stdout || '(kosong)'}`);
      if (result.stderr) print('stderr', result.stderr);

      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Command executed: ${step.command}\nExit code: ${result.code}\nStdout: ${result.stdout || '(kosong)'}`, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      } else {
        logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      }
      history.push({ action: 'bash', command: step.command, approved: true, result });
      continue;
    }
  }

  print('stop', `Sampai batas ${MAX_LOOPS} langkah tanpa selesai.`);
  if (threadId) {
    logStep({ threadId, role: 'assistant', content: `Reached loop limit of ${MAX_LOOPS} without completing task.`, actionType: 'stop', reasoning: 'Loop limit reached' });
  }
  blank();
}
