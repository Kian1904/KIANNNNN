// src/run-task.js — Handler loop agen otonom (ReAct)

import fs from 'fs';
import path from 'path';
import { askWithFallback, fallbackState } from './providers.js';
import { planStep, planStepWithRetry, buildHistoryText } from './plan.js';
import { showDiff } from './diff.js';
import { runCommand } from './bash.js';
import { logStep, saveDecision, getRecentDecisions, saveSnapshot } from './db.js';
import { executeBash } from './core/execution/bash.js';
import { executeSafeMutation, executeDestructive, lintWrittenFile } from './core/execution/files.js';
import { executeSearch, executeFetch } from './core/execution/web.js';
import { executeMcp } from './core/execution/mcp.js';
import { searchWeb } from './search.js';
import { fetchWebPage, focusWebText } from './web-fetch.js'
import { verifyAction } from './verifier.js';
import { print, printBlock, sep, blank, actionIndicator } from './ui.js';
import { readFileSafe, readFileRange, listDirSafe, isSafePath } from './utils/fs.js';
import { inspectTarget, describeTarget, rejectReason, rejectWriteReason, applyFileOp, applySafeFileOp, lintAfterWrite } from './file-ops.js';
import { preflightEnvironment } from './environment.js';
import { delegateTask } from './optional/delegation.js';
import { createTaskState, allCompleted } from './task-state.js';
import { contractBlocksCompletion } from './task-contract.js';
import { TASK_STATUS, readJournal, replayJournal, taskPath, defaultJournalDir } from './task-journal.js';
import { decideRecovery, buildRecoveryHint } from './recovery.js';
import { detectTestRunner, buildTestCommand, parseTestOutput } from './test-orchestrator.js';
import { runReview } from './review-engine.js';
import { wrapUntrusted, scanForInjection } from './prompt-shield.js';
import { readEnv } from './env.js';
import { packetFromHistory, buildEvidenceFallback, compactResearchContext } from './optional/research.js';

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:task]', ...args); };

/** Evidence mapping lives in src/core/evidence.js. */
import { evidenceForContract } from './core/evidence.js';
import { createTaskContext } from './core/task-context.js';
import { createTaskRuntimeConfig } from './core/task-config.js';
import { checkAllowedAction } from './core/action-policy.js';
import { formatReadResult, normalizeListTarget } from './core/fs-actions.js';
import { buildBashHistory, formatBashOutput } from './core/bash-actions.js';
import { buildMutationPlan, buildMutationHistory } from './core/file-mutation.js';
import { buildEditHistory, buildDestructiveHistory, buildWebHistory, buildMcpHistory, buildChatHistory, buildRememberHistory, buildReadHistory, buildListHistory, buildDelegateHistory } from './core/action-results.js';
import { buildEditPlan, buildDestructivePlan, destructiveVerb, formatDestructivePreview } from './core/file-execution.js';
import { buildDelegateRequest, buildMcpRequest, buildSearchRecord, buildFetchRecord, normalizeDelegateError } from './core/external-actions.js';
import { collectUrls, chooseOfficialUrl, buildForcedResearchPrompt } from './core/web-planning.js';
import { historyError, historyCondition, historyNote } from './core/history-actions.js';
import { evaluateCompletion } from './core/completion-gate.js';
export { evidenceForContract };

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
 * @param {Object|null} agentConfig - config agent ber-role (src/agents.js); null = generic
 */
export async function runTask(instruction, agentMd, availableTools, threadId, stats, trackProvider, trackAction, isDangerous, askApproval, agentConfig = null) {
  if (stats) stats.tasks++;
  // Core task context owns history, contract, and journal persistence.
  const taskContext = createTaskContext({
    instruction,
    agentConfig,
    threadId,
    journalEnabled: readEnv('JOURNAL') !== '0',
  });
  const { history, contract, journal, journalLog, pushHistory } = taskContext;
  let taskState = null;
  const contractResults = new Map();
  let lastTarget = null;
  const recentMemory = getRecentDecisions(5);
  let webSearchCount = 0;

  // --- Konfigurasi agent (null = generic, perilaku lama persis) ---
  if (agentConfig?.environment) {
    const preflight = await preflightEnvironment(agentConfig.environment);
    if (preflight.status === 'blocked') {
      const reason = preflight.missing.map(x => `${x.type}:${x.name || x.path}`).join(', ');
      print('blocked', `Environment agent "${agentConfig.name}" belum siap: ${reason}`);
      return `Task diblokir: environment ${agentConfig.name} belum siap (${reason}).`;
    }
    if (preflight.status === 'degraded') {
      print('warn', `Environment agent "${agentConfig.name}" degraded: ${preflight.optionalMissing.map(x => `${x.type}:${x.name || x.path}`).join(', ')}`);
    }
  }
  const runtimeConfig = createTaskRuntimeConfig({ agentConfig, agentMd, availableTools, contract });
  const { maxLoops, budget, toolsForAgent, allowedActions } = runtimeConfig;
  let systemPromptOverride = runtimeConfig.systemPromptOverride;
  if (contract.acceptance.length > 0) {
    print('info', `Kontrak task: ${contract.acceptance.length} kriteria (risk: ${contract.risk})`);
  }
  let blockedCount = 0;
  // M50: hitung kegagalan berturut-turut untuk kebijakan recovery.
  let consecutiveFailures = 0;

  dbg('=== Task Start ===');
  dbg('Instruction:', instruction);
  dbg('agent:', agentConfig ? `${agentConfig.name} (maxLoops=${maxLoops}, actions=${allowedActions.join('|')}, tools=${toolsForAgent.length})` : 'generic');
  dbg('agentMd:', agentMd ? `loaded (${agentMd.length} chars)` : 'not found');
  dbg('recentMemory:', recentMemory.length, 'entries');
  dbg('availableTools:', toolsForAgent?.map(t => t.name) || []);

  for (let i = 1; i <= maxLoops; i++) {
    const fileSnapshot = readFileSafe(lastTarget);
    dbg(`--- Loop ${i} ---`);
    dbg('fileSnapshot:', fileSnapshot.slice(0, 100) + (fileSnapshot.length > 100 ? '...' : ''));

    // Retry di sini, bukan biarin throw matiin task. Model gratisan kadang
    // balas teks biasa; satu balasan jelek dulu = seluruh task mati.
    const sr = await planStepWithRetry(askWithFallback, { instruction, fileSnapshot, history, agentMd, recentMemory, availableTools: toolsForAgent, webSearchCount, systemPromptOverride }, {
      maxAttempts: 3,
      onRetry: (n, max, msg) => {
        print('info', `Balasan model gak keparse (percobaan ${n}/${max}) — minta ulang dengan koreksi...`);
        dbg('retry karena:', msg.split('\n')[0]);
      },
    });

    if (!sr.ok) {
      // Habis 3 percobaan masih sampah. JANGAN throw — kasih hasil apa adanya
      // biar user tau kenapa, dan progress sebelumnya gak hilang.
      print('error', `Model gagal balas format yang benar setelah ${sr.attempts}x percobaan.`);
      printBlock(String(sr.lastError || '').split('\n')[0], 2);
      const hasEvidence = history.some(h => h.action === 'web_search' || h.action === 'web_fetch');
      const fallbackSummary = hasEvidence
        ? buildEvidenceFallback(instruction, history)
        : history.length > 0
          ? `Task berhenti: model tidak balas format yang benar.\n\nYang sudah dikerjakan (${history.length} langkah):\n${buildHistoryText(history)}`
          : 'Task gagal: model tidak balas format yang benar sejak langkah pertama.';
      if (hasEvidence) {
        print('info', 'Provider/format gagal — jawaban disusun langsung dari evidence riset (tanpa LLM).');
      }
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: fallbackSummary, actionType: 'done', detail: { stopped: 'llm-format-failure', attempts: sr.attempts } });
      }
      return fallbackSummary;
    }

    let step = sr.step;
    // Guard praktis: kalau model mengulang web_search setelah dua pencarian,
    // jangan buang kuota dengan query identik. Ambil URL terbaik dari hasil yang
    // sudah ada dan fetch isinya. Ini fallback fleksibel, bukan kewajiban
    // web_fetch di setiap riset.
    if (step.action === 'web_search' && webSearchCount >= 2) {
      const candidates = history
        .filter(h => h.action === 'web_search')
        .flatMap(h => String(h.summary || '').match(/https?:\/\/[^\s)]+/g) || []);
      const official = candidates.find(u => /bmkg\.go\.id|\.gov\.|\.go\.id\//i.test(u));
      const chosen = official || candidates[0];
      if (chosen) {
        print('info', `Search diulang — ambil isi sumber yang sudah ditemukan: ${chosen}`);
        step = { action: 'web_fetch', url: chosen, reasoning: step.reasoning };
      }
    }
    if (sr.attempts > 1) dbg(`step berhasil setelah ${sr.attempts} percobaan`);
    
    if (trackProvider) trackProvider(fallbackState.lastProvider);
    if (trackAction) trackAction(step.action);

    dbg('Parsed step:', JSON.stringify({ action: step.action, target: step.target, tool: step.tool }).replace(/undefined/g, '-'));

    // --- WHITELIST AGENT: tolak aksi di luar kapasitas role ini ---
    const actionPolicy = checkAllowedAction(agentConfig, step.action);
    if (!actionPolicy.allowed) {
      blockedCount++;
      print('blocked', actionPolicy.reason);
      pushHistory({
        action: 'user_condition',
        condition: actionPolicy.reason
      });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Blocked disallowed action ${step.action} for agent ${agentConfig.name}`, actionType: 'blocked', reasoning: step.reasoning, approved: false });
      }
      if (blockedCount >= 3) {
        const msg = `Agent "${agentConfig.name}" terus memilih aksi terlarang (${blockedCount}x) — task dihentikan.`;
        print('stop', msg);
        blank();
        return msg;
      }
      continue;
    }

    // --- DONE ---
    if (step.action === 'done') {
      // M44: cek internal checklist dulu sebelum terima done
      if (taskState && !allCompleted(taskState)) {
        const pending = taskState.items.filter(i => i.status === 'pending').map(i => i.description).join(', ');
        print('blocked', `Belum boleh selesai — checklist masih ada yang pending: ${pending}`);
        pushHistory({ action: 'user_condition', condition: `[SISTEM: ACTION done DITOLAK. Checklist belum selesai: ${pending}. Selesaikan semua item dulu.]` });
        continue;
      }
      // M51: test orchestrator gate — kalau contract punya kriteria test dan
      // project punya test runner, jalankan test NYATA sebelum done diterima.
      // Hasilnya di-parse jadi structured result lalu masuk history sebagai bukti.
      const needsTest = contract.acceptance.some(a => /test/i.test(a.text));
      let testResult = null;
      if (needsTest) {
        const detected = detectTestRunner({ root: process.cwd() });
        if (detected) {
          const cmd = buildTestCommand(detected);
          print('info', `M51 test orchestrator: menjalankan ${cmd}`);
          try {
            const result = await runCommand(cmd);
            const parsed = parseTestOutput(result.stdout || '', detected.runner);
            const testVerified = result.code === 0 && parsed.passed;
            testResult = { required: true, passed: testVerified, summary: parsed.summary, failures: parsed.failures, runner: detected.runner };
            journalLog({
              type: 'action', action: 'test', command: cmd,
              verified: testVerified, error: testVerified ? undefined : `test gagal (${parsed.summary})`,
            });
            pushHistory({
              action: 'bash', command: cmd,
              approved: true,
              result: { ok: testVerified, code: result.code, stdout: parsed.summary, stderr: result.stderr || '' },
              verified: testVerified,
              error: testVerified ? undefined : `test gagal: ${parsed.summary}`,
              testResult: parsed,
            });
            if (testVerified) {
              print('verify_ok', `test PASS: ${parsed.summary}`);
            } else {
              print('error', `test FAIL: ${parsed.summary}`);
              parsed.failures.slice(0, 5).forEach(f => printBlock(`  ${f}`, 2));
              systemPromptOverride = `${systemPromptOverride || ''}\n\n[SISTEM TEST: Test project GAGAL: ${parsed.summary}. ${parsed.failures.slice(0, 3).join('; ')}. Perbaiki penyebabnya sebelum ACTION: done.]`;
              continue;
            }
          } catch (err) {
            journalLog({ type: 'action', action: 'test', verified: false, error: err.message });
            print('error', `test orchestrator gagal: ${err.message}`);
          }
        }
      }
      // M47: gerbang kontrak. Bukti diambil dari hasil ACTUAL yang sudah tercatat
      // di history (verified:true), bukan dari narasi model.
      const gateResults = evidenceForContract(history, contract);
      contractResults.clear();
      for (const res of gateResults) contractResults.set(res.id, res);
      const review = runReview({ contract, history, summary: step.summary });
      const completionDecision = evaluateCompletion({
        checklist: taskState,
        summary: step.summary,
        history,
        contract,
        evidence: gateResults,
        testResult,
        review,
      });
      if (!completionDecision.approved) {
        print('blocked', `Klaim selesai DITOLAK — ${completionDecision.reason}.`);
        pushHistory({ action: 'user_condition', condition: `[SISTEM: ACTION done DITOLAK: ${completionDecision.reason}. Buktikan dengan aksi nyata sebelum done.]` });
        continue;
      }
      // Completion gate sudah mengevaluasi review; di sini hanya catat hasilnya.
      journalLog({ type: 'note', text: `review: ${review.verdict} — ${review.verifiedActions}/${review.totalActions} aksi terverifikasi` });

      actionIndicator('done');
      print('done', step.summary);
      // M48: catat bukti per kriteria + status terminal ke journal.
      for (const [id, res] of contractResults.entries()) {
        journalLog({ type: 'acceptance', id, status: res.status, evidence: res.evidence });
      }
      journalLog({ type: 'status', status: TASK_STATUS.COMPLETED, summary: step.summary });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: step.summary, actionType: 'done', reasoning: step.reasoning, approved: true, verified: true });
      } else {
        logStep({ task: instruction, actionType: 'done', detail: null, reasoning: step.reasoning, approved: true, verified: true });
      }
      blank();
      return step.summary;
    }

    // --- CHAT (no step header, no ceremony) ---
    if (step.action === 'chat') {
      actionIndicator('chat');
      blank();
      printBlock(step.reply);
      blank();
      pushHistory(buildChatHistory(step.reply));
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: step.reply, actionType: 'chat', reasoning: step.reasoning });
      }
      continue;
    }

    // Untuk semua action teknis — baru tampilkan header
    blank();
    sep();
    print('step', `${i} / ${maxLoops}`);
    sep();
    print('provider', fallbackState.lastProvider);
    print('reasoning', step.reasoning);

    // --- READ ---
    if (step.action === 'read') {
      actionIndicator('read', step.target);
      // Offset/limit opsional dari model: kalau dia mau lanjut baca file gede,
      // dia bisa set step.limit + step.offset. Default 400 baris dengan nomor
      // baris — biar bug di baris 500 KELIHATAN, gak ketutup truncate 2000 char.
      const r = readFileRange(step.target, step.offset || 1, step.limit || 400);
      const { label, content: preview } = formatReadResult(step.target, r);
      print('read', label);
      printBlock(preview);
      pushHistory(buildReadHistory(step.target, preview, { start: r.start, end: r.end, total: r.totalLines }));
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Read file: ${step.target}\n${preview}`, actionType: 'read', reasoning: step.reasoning });
      }
      continue;
    }

    // --- LIST_DIR ---
    if (step.action === 'list_dir') {
      actionIndicator('list_dir', step.target);
      const dir = normalizeListTarget(step.target);
      const listing = listDirSafe(dir);
      print('list_dir', dir);
      printBlock(listing);
      pushHistory(buildListHistory(dir, listing));
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Listed directory: ${dir}\n${listing}`, actionType: 'list_dir', reasoning: step.reasoning });
      }
      continue;
    }

    // --- REMEMBER ---
    if (step.action === 'remember') {
      actionIndicator('remember', step.key);
      saveDecision({ key: step.key, value: step.value, context: instruction });
      print('remember', `${step.key}: ${step.value}`);
      pushHistory(buildRememberHistory(step.key, step.value));
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Remembered: ${step.key} = ${step.value}`, actionType: 'remember', reasoning: step.reasoning });
      }
      continue;
    }

    // --- DELEGATE CLI AGENT ---
    if (step.action === 'delegate') {
      actionIndicator('delegate', `${step.agent}: ${step.task}`);
      if (!['qwen', 'claude', 'agy'].includes(step.agent)) {
        const error = `CLI agent tidak diizinkan: ${step.agent}`;
        print('blocked', error);
        pushHistory({ action: 'delegate', agent: step.agent, task: step.task, verified: false, error });
        continue;
      }
      const approval = await askApproval(`delegate ke ${step.agent}`);
      if (!approval.approved) {
        const error = 'delegasi dibatalkan oleh user';
        pushHistory({ action: 'delegate', agent: step.agent, task: step.task, approved: false, verified: false, error });
        return `Delegasi dibatalkan: ${step.agent}.`;
      }
      if (!budget.consume('providerCall')) {
        const error = 'budget provider call habis';
        print('blocked', error);
        pushHistory({ action: 'delegate', agent: step.agent, task: step.task, approved: true, verified: false, error });
        continue;
      }
      const delegateRequest = buildDelegateRequest(step.agent, step.task, process.cwd());
      const result = await delegateTask(delegateRequest.agent, delegateRequest.task, delegateRequest.options);
      if (result.ok) {
        print('delegate_ok', `${step.agent}: ${result.summary.slice(0, 2000)}`);
        pushHistory(buildDelegateHistory(step.agent, step.task, { summary: result.summary, artifacts: result.artifacts || [], changed_files: result.changed_files || [], tests: result.tests || [], tests_passed: result.tests_passed === true, approved: true, verified: result.verified === true }));
      } else {
        const delegateError = normalizeDelegateError(result);
        print('delegate_err', `${step.agent}: ${delegateError}`);
        pushHistory({ action: 'delegate', agent: step.agent, task: step.task, approved: true, verified: false, error: delegateError });
        pushHistory({ action: 'user_condition', condition: `[SISTEM: Delegasi ke ${step.agent} GAGAL: ${delegateError}. Kamu WAJIB memperbaiki task atau coba pendekatan lain sebelum bilang done.]` });
      }
      continue;
    }

    // --- MCP_CALL ---
    if (step.action === 'mcp_call') {
      actionIndicator('mcp_call', step.tool);
      print('mcp', `Memanggil tool: ${step.tool}`);
      try {
        const mcpRequest = buildMcpRequest(step.tool, step.toolArgs);
        const result = await executeMcp(mcpRequest.tool, mcpRequest.args, toolsForAgent);
        print('mcp', 'Hasil:');
        printBlock(result.slice(0, 2500) + (result.length > 500 ? '...' : ''));
        pushHistory(buildMcpHistory(step.tool, wrapUntrusted(result, 'mcp_call', step.tool)));
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Called tool: ${step.tool}\nResult: ${result.slice(0, 500)}${result.length > 500 ? '...' : ''}`, actionType: 'mcp_call', detail: { tool: step.tool, result }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('mcp_err', err.message);
        pushHistory(historyError('mcp_call', err.message, { tool: step.tool, result: `ERROR: ${err.message}` }));
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
        return 'Task selesai dengan mcp_call.';
      }
      continue;
    }

// --- WEB_SEARCH ---
    if (step.action === 'web_search') {
      actionIndicator('web_search', step.query);
      webSearchCount++;
      if (!budget.consume('search')) {
        // Kalau model tetap memilih search setelah budget habis, pakai URL resmi yang
        // sudah ditemukan untuk fetch sekali—jangan buang hasil riset cuma karena
        // model mengulang ACTION web_search.
        const candidates = collectUrls(history);
        const chosen = chooseOfficialUrl(candidates);
        if (chosen && budget.consume('fetch')) {
          print('info', `Batas search tercapai — ambil isi sumber: ${chosen}`);
          const page = await executeFetch(chosen);
          if (page.ok) {
            pushHistory({ action: 'web_fetch', url: page.url, summary: wrapUntrusted(focusWebText(page.text, instruction).slice(0, 30000), 'web_fetch', page.url) });
            actionIndicator('web_fetch', chosen);
            printBlock(page.text.slice(0, 800), 2);
            print('info', `Isi halaman disimpan ke history (${page.text.length} karakter) — agent akan merangkum, bukan menyalin mentah.`);
          } else {
            pushHistory({ action: 'web_fetch', url: chosen, summary: `ERROR: ${page.error}` });
          }
        }
        print('info', `Budget search habis (${budget.snapshot().limits.searches}x) — memaksa rangkuman dari data yang ada.`);
        const researchPacket = packetFromHistory(history, instruction);
        const compactEvidence = compactResearchContext(researchPacket, { maxChars: 1500 });
        const forcedInstruction = buildForcedResearchPrompt(instruction, compactEvidence);
        const fr = await planStepWithRetry(askWithFallback, { instruction: forcedInstruction, fileSnapshot, history, agentMd, recentMemory, availableTools: toolsForAgent, webSearchCount, systemPromptOverride }, { maxAttempts: 2 });
        const forcedStep = fr.ok ? fr.step : { action: 'done', summary: '', reasoning: 'paksa selesai (model gak kooperatif)' };
        // Model gak kooperatif / summary kosong → jawab dari evidence terstruktur,
        // BUKAN step.summary (step di sini web_search, summary-nya undefined).
        const evidenceSummary = buildEvidenceFallback(instruction, history);
        if (forcedStep.action === 'done' && forcedStep.summary && forcedStep.summary.trim()) {
          print('done', forcedStep.summary);
          if (threadId) {
            logStep({ threadId, role: 'assistant', content: forcedStep.summary, actionType: 'done', reasoning: forcedStep.reasoning });
          }
          blank();
          return forcedStep.summary;
        }
        print('done', evidenceSummary);
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: evidenceSummary, actionType: 'done', reasoning: forcedStep.reasoning || 'forced-evidence-fallback' });
        }
        blank();
        return evidenceSummary;
      }

      print('web_search', step.query);
      try {
        const { provider, results } = await executeSearch(step.query);
        print('sources', results.length ? results.map(r => r.url).join('\n') : '(tidak ada hasil)');
        const summary = results
          .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n');
        const searchRecord = buildSearchRecord(step.query, provider, results);
        pushHistory({ ...searchRecord, summary: wrapUntrusted(searchRecord.summary, 'web_search', step.query) });

        // Safety net fleksibel: kalau sudah dua search dan belum pernah membaca
        // halaman, ambil satu sumber resmi terbaik. Model tetap boleh langsung
        // done pada kasus snippet yang cukup; fetch ini hanya memastikan riset
        // data-spesifik (cuaca/harga/status) gak berhenti di daftar URL.
        if (webSearchCount >= 2 && !history.some(h => h.action === 'web_fetch') && budget.consume('fetch')) {
          const candidates = collectUrls(history);
          const official = chooseOfficialUrl(candidates);
          const ordered = [...new Set([official, ...candidates].filter(Boolean))];
          let fetched = false;
          for (const chosen of ordered.slice(0, 3)) {
            print('info', `Dua search selesai — baca sumber terbaik: ${chosen}`);
            const page = await executeFetch(chosen);
            if (page.ok) {
              pushHistory({ action: 'web_fetch', url: page.url, summary: wrapUntrusted(focusWebText(page.text, instruction).slice(0, 30000), 'web_fetch', page.url) });
              actionIndicator('web_fetch', chosen);
              printBlock(page.text.slice(0, 800), 2);
              print('info', `Isi halaman disimpan ke history (${page.text.length} karakter) — agent akan merangkum, bukan menyalin mentah.`);
              fetched = true;
              break;
            }
          }
          if (!fetched) pushHistory({ action: 'web_fetch', url: ordered[0] || '', summary: 'ERROR: semua sumber kandidat gagal di-fetch' });
        }
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Searched: ${step.query}\nSources: ${results.map(r => r.url).join(', ')}`, actionType: 'web_search', detail: { query: step.query, provider, sources: results.map(r => r.url) }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('search_err', err.message);
        pushHistory({ action: 'web_search', query: step.query, provider: null, summary: `ERROR: ${err.message}` });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Search error: ${step.query}\nError: ${err.message}`, actionType: 'web_search', detail: { query: step.query, error: err.message }, reasoning: step.reasoning });
        }
      }
      continue;
    }

    // --- WEB_FETCH ---
    if (step.action === 'web_fetch') {
      if (!budget.consume('fetch')) {
        print('blocked', `Budget fetch habis (${budget.snapshot().limits.fetches}x) — pakai data yang sudah ada di history.`);
        pushHistory(historyCondition(`Budget web_fetch habis. Jangan fetch lagi; rangkum evidence yang sudah ada.`));
        continue;
      }
      actionIndicator('web_fetch', step.url);
      try {
        const page = await executeFetch(step.url);
        if (!page.ok) {
          print('search_err', `Fetch gagal (${page.error})${page.status ? ` HTTP ${page.status}` : ''}`);
          pushHistory({ action: 'web_fetch', url: step.url, summary: `ERROR: ${page.error}${page.status ? ` HTTP ${page.status}` : ''}`, verified: false, error: page.error });
        } else {
          const summary = page.text || '(halaman kosong)';
          printBlock(summary.slice(0, 800), 2);
          print('info', `Isi halaman disimpan ke history (${summary.length} karakter) — agent akan merangkum, bukan menyalin mentah.`);
          const fetchVerification = verifyAction({ action: 'web_fetch', text: summary });
          pushHistory(buildFetchRecord(page.url, focusWebText(summary, instruction).slice(0, 30000), fetchVerification.ok, fetchVerification.reason));
          if (threadId) {
            logStep({ threadId, role: 'assistant', content: `Fetched: ${page.url}`, actionType: 'web_fetch', detail: { url: page.url, status: page.status, chars: summary.length }, reasoning: step.reasoning });
          }
        }
      } catch (err) {
        print('search_err', err.message);
        pushHistory({ action: 'web_fetch', url: step.url, summary: `ERROR: ${err.message}` });
      }
      continue;
    }

    // --- WRITE / APPEND / MKDIR ---
    if (step.action === 'write' || step.action === 'append' || step.action === 'mkdir') {
      actionIndicator(step.action, step.target);
      const rejected = rejectWriteReason(step.target, step.action);
      if (rejected) {
        print('blocked', `${step.action} ditolak: ${rejected}`);
        pushHistory({ action: step.action, target: step.target, verified: false, error: rejected });
        continue;
      }
      if (step.action === 'write' || step.action === 'append') {
        print('diff', step.target);
        const before = fs.existsSync(step.target) ? fs.readFileSync(step.target, 'utf8') : '';
        printBlock(showDiff(before, step.action === 'append' ? before + step.content : step.content));
      } else printBlock(`Direktori baru: ${step.target}`);
      sep();
      const opApproval = await askApproval(step.action);
      if (!opApproval.approved) return `${step.action} dibatalkan, task dihentikan.`;
      try {
        const oldContent = fs.existsSync(step.target) ? fs.readFileSync(step.target, 'utf8') : '';
        const mutation = buildMutationPlan({ action: step.action, target: step.target, before: oldContent, content: step.content });
        const content = mutation.finalContent;
        if (step.action !== 'mkdir') saveSnapshot({ filepath: step.target, content: oldContent, isNewFile: !fs.existsSync(step.target) });
        const result = executeSafeMutation(step.action, step.target, step.content);
        if (!result.ok) return `${step.action} gagal: ${result.error}`;
        // M44: auto-lint gate — cek syntax file JS setelah tulis, rollback kalau error
        if (step.action !== 'mkdir') {
          const lint = lintWrittenFile(step.target, oldContent);
          if (!lint.ok) {
            print('error', lint.error);
            pushHistory({ action: step.action, target: step.target, approved: true, verified: false, error: lint.error });
            pushHistory({ action: 'user_condition', condition: buildRecoveryHint({ error: lint.error, action: step.action, attempt: consecutiveFailures + 1 }) });
            continue;
          }
        }
        const actual = step.action === 'mkdir' ? fs.existsSync(step.target) : fs.readFileSync(step.target, 'utf8');
        const verification = step.action === 'mkdir' ? { ok: fs.statSync(step.target).isDirectory(), reason: 'direktori terbukti ada' } : verifyAction({ action: 'edit', target: step.target, expectedContent: content, actualContent: actual });
        print(verification.ok ? 'verify_ok' : 'error', verification.reason);
        pushHistory(buildMutationHistory(step.action, step.target, result, verification));
        continue;
      } catch (err) {
        pushHistory({ action: step.action, target: step.target, verified: false, error: err.message });
        return `${step.action} gagal: ${err.message}`;
      }
    }

    // --- EDIT ---
    // Dikembalikan 2026-10-17 setelah commit bff2c6a (30 Agt) "fixed syntax error"
    // menghapus seluruh handler ini — sejak itu ACTION: edit diparse tapi tak pernah
    // dieksekusi dan saveSnapshot tak pernah terpanggil (rollback tanpa data).
    if (step.action === 'edit') {
      actionIndicator('edit', step.target);
      const target = step.target;

      // Guard EKSPLISIT: readFileSafe menolak di jalur BACA, tapi tulis butuh cek
      // sendiri — tanpa ini path terblokir (.env, .git, keluar root) tetap ke-tulis.
      if (!isSafePath(target)) {
        print('blocked', `Path diblokir karena keamanan: ${target}`);
        pushHistory({ action: 'edit', target, approved: false });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Edit blocked (unsafe path): ${target}`, actionType: 'edit', detail: { target, blocked: true }, reasoning: step.reasoning, approved: false });
        }
        continue;
      }

      const existedBefore = fs.existsSync(target);
      const oldContent = existedBefore ? fs.readFileSync(target, 'utf8') : '';
      const editPlan = buildEditPlan(target, oldContent, step.new_content);

      print('diff', target);
      printBlock(showDiff(oldContent, step.new_content));
      sep();

      const editApproval = await askApproval('edit');
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Edit requested: ${target}`, actionType: 'edit', detail: { target, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: editApproval.approved });
      }
      if (!editApproval.approved) {
        print('rejected', 'Langkah dibatalkan, task dihentikan.');
        pushHistory({ action: 'edit', target, approved: false });
        return 'Edit dibatalkan, task dihentikan.';
      }
      if (editApproval.condition) {
        pushHistory({ action: 'user_condition', condition: editApproval.condition });
      }

      // Snapshot SEBELUM tulis — utk SEMUA file, termasuk file BARU
      // (is_new_file=1 -> rollback = hapus file). Gagal snapshot = edit dibatalkan,
      // jangan tulis tanpa jaring pengaman rollback.
      try {
        saveSnapshot({ filepath: target, content: oldContent, isNewFile: !existedBefore });
        print('snapshot', editPlan.existedBefore ? `${target} disimpan.` : `${target} (file baru) — rollback = hapus file.`);
      } catch (err) {
        print('error', `Gagal simpan snapshot: ${err.message} — edit DIBATALKAN.`);
        return 'Edit dibatalkan: snapshot gagal disimpan.';
      }

      try {
        const parent = path.dirname(target);
        if (parent && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(target, step.new_content, 'utf8');
      } catch (err) {
        print('error', `Gagal menulis ${target}: ${err.message}`);
        pushHistory({ action: 'edit', target, approved: true, error: err.message });
        return `Edit gagal: ${err.message}`;
      }
      // M44: auto-lint gate untuk edit
      const editLint = lintWrittenFile(target, oldContent);
      if (!editLint.ok) {
        print('error', editLint.error);
        pushHistory(buildEditHistory(target, false, editLint.error));
        pushHistory(historyCondition(buildRecoveryHint({ error: editLint.error, action: 'edit', attempt: consecutiveFailures + 1 })));
        continue;
      }

      const editVerification = verifyAction({ action: 'edit', target, expectedContent: step.new_content, actualContent: fs.readFileSync(target, 'utf8') });
      print(editVerification.ok ? 'verify_ok' : 'error', editVerification.reason);
      print('edit_ok', `${target} ${existedBefore ? 'diupdate' : 'dibuat'}.`);
      lastTarget = target;
      pushHistory(buildEditHistory(target, editVerification.ok, editVerification.reason));
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `File edited: ${target}`, actionType: 'edit', detail: { target, applied: true, isNewFile: !existedBefore }, reasoning: step.reasoning });
      }
      continue;
    }

    // --- DELETE / RENAME / MOVE ---
    // Gate-nya ada di modes.js (DESTRUCTIVE_ACTIONS) dan approval.js
    // (isDangerous). Handler ini yang eksekusi — TIDAK boleh nge-bypass gate,
    // dan SELALU minta approval (safe & wellwell nolak, yolo auto-approve).
    if (step.action === 'delete' || step.action === 'rename' || step.action === 'move') {
      actionIndicator(step.action, step.dest ? `${step.target} → ${step.dest}` : step.target);

      // Guard path SEBELUM apa-apa — jangan tampilin diff buat path terblokir.
      if (!isSafePath(step.target)) {
        print('blocked', `Path diblokir karena keamanan: ${step.target}`);
        pushHistory({ action: step.action, target: step.target, approved: false, blocked: true });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `${step.action} blocked (unsafe path): ${step.target}`, actionType: step.action, detail: { target: step.target, blocked: true }, reasoning: step.reasoning, approved: false });
        }
        continue;
      }

      const info = inspectTarget(step.target);
      const destructivePlan = buildDestructivePlan(step.action, step.target, step.dest, info);
      const reject = rejectReason(step.target, info);
      if (reject) {
        print('blocked', `Tidak bisa ${step.action} ${step.target}: ${reject}`);
        pushHistory({ action: step.action, target: step.target, approved: false, error: reject });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `${step.action} rejected: ${reject}`, actionType: step.action, detail: { target: step.target, error: reject }, reasoning: step.reasoning, approved: false });
        }
        continue;
      }

      // Tampilkan APA yang bakal kena, jangan cuma nama file. Hapus file
      // tanpa nunjukin isinya = user approve sesuatu yang dia gak liat.
      print('diff', step.dest ? `${step.target} → ${step.dest}` : step.target);
      const desc = describeTarget(destructivePlan.target, destructivePlan.info);
      printBlock(formatDestructivePreview({ action: destructivePlan.action, target: destructivePlan.target, info: destructivePlan.info, description: desc }));
      sep();

      const opApproval = await askApproval(step.action);
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `${step.action} requested: ${step.target}`, actionType: step.action, detail: { target: step.target, dest: step.dest, providerUsed: fallbackState.lastProvider }, reasoning: step.reasoning, approved: opApproval.approved });
      }
      if (!opApproval.approved) {
        print('rejected', 'Langkah dibatalkan, task dihentikan.');
        pushHistory({ action: step.action, target: step.target, approved: false });
        return `${step.action} dibatalkan, task dihentikan.`;
      }
      if (opApproval.condition) {
        pushHistory({ action: 'user_condition', condition: opApproval.condition });
      }

      // SNAPSHOT WAJIB buat delete. Tanpa isi file di DB, /rollback cuma bisa
      // bilang "file-nya udah ilang". Gagal simpan = hapus DIBATALKAN.
      // rename/move gak butuh: file-nya masih ada, cuma pindah nama/lokasi.
      if (step.action === 'delete' && info.kind === 'file') {
        try {
          saveSnapshot({ filepath: step.target, content: info.content, isNewFile: false });
          print('snapshot', `${step.target} disimpan — /rollback bisa balikin.`);
        } catch (err) {
          print('error', `Gagal simpan snapshot: ${err.message} — delete DIBATALKAN.`);
          return 'Delete dibatalkan: snapshot gagal disimpan.';
        }
      }

      const res = executeDestructive(step.action, step.target, step.dest);
      if (!res.ok) {
        print('error', `Gagal ${step.action} ${step.target}: ${res.error}`);
        pushHistory({ action: step.action, target: step.target, approved: true, error: res.error });
        return `${step.action} gagal: ${res.error}`;
      }

      const verb = destructiveVerb(step.action, step.dest);
      print(`${step.action}_ok`, `${step.target} ${verb}.`);
      lastTarget = step.dest || step.target;
      pushHistory(buildDestructiveHistory(step.action, step.target, step.dest, true));
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `${step.action} applied: ${step.target}`, actionType: step.action, detail: { target: step.target, dest: step.dest, applied: true }, reasoning: step.reasoning });
      }
      continue;
    }

    // --- BASH ---
    if (step.action === 'bash') {
      actionIndicator('bash', step.command);
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
          return 'Command dibatalkan, task dihentikan.';
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
        return 'Command dibatalkan, task dihentikan.';
      }
      if (bashApproval.condition) {
        pushHistory({ action: 'user_condition', condition: bashApproval.condition });
      }

      const result = await executeBash(step.command);
      const bashVerification = verifyAction({ action: 'bash', result });
      print(bashVerification.ok ? 'verify_ok' : 'error', bashVerification.reason);
      print('exit_code', `${result.code}  stdout: ${result.stdout || '(kosong)'}`);
      if (result.stderr) print('stderr', result.stderr);

      if (threadId) {
        logStep({ threadId, role: 'assistant', content: formatBashOutput(step.command, result), actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      } else {
        logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      }
      pushHistory(buildBashHistory(step.command, result, bashVerification));

      // M50: recovery engine. Bash yang gagal tidak cuma dicatat — diklasifikasi
      // lalu diberi hint spesifik supaya model memperbaiki penyebabnya, bukan
      // mengulang command yang sama.
      if (!bashVerification.ok) {
        consecutiveFailures++;
        const decision = decideRecovery({
          error: `${result.stderr || ''} ${bashVerification.reason || ''} exit ${result.code}`,
          action: 'bash',
          command: step.command,
          attempt: consecutiveFailures,
        });
        journalLog({ type: 'note', text: `recovery bash: ${decision.action} (${decision.kind}) ${decision.reason}` });
        if (decision.action === 'stop') {
          const stopMsg = `Task dihentikan oleh recovery engine: ${decision.reason}`;
          print('stop', stopMsg);
          journalLog({ type: 'status', status: TASK_STATUS.FAILED, reason: decision.reason });
          pushHistory(historyNote(stopMsg))
          return stopMsg;
        }
        pushHistory(historyCondition(buildRecoveryHint({
          error: `${result.stderr || ''} ${bashVerification.reason || ''}`,
          action: 'bash',
          attempt: consecutiveFailures,
        })));
      } else {
        consecutiveFailures = 0;
      }
      continue;
    }
  }

  print('stop', `Sampai batas ${maxLoops} langkah tanpa selesai.`);

  // M47: batas langkah BUKAN keberhasilan. Kembalikan laporan eksplisit yang
  // menyebut kriteria belum terbukti, supaya pemanggil (REPL/Telegram/squad)
  // tidak bisa salah menganggap task beres. Sebelumnya fungsi ini return
  // undefined — permukaan klaim palsu.
  const pendingCriteria = contractBlocksCompletion(
    contract,
    evidenceForContract(history, contract)
  );
  const verifiedCount = history.filter(h => h.verified === true).length;
  const report = [
    `Task BELUM selesai: batas ${maxLoops} langkah tercapai tanpa memenuhi kontrak.`,
    `Aksi terverifikasi: ${verifiedCount}.`,
    pendingCriteria.pending.length
      ? `Kriteria belum terbukti:\n${pendingCriteria.pending.map(t => `- ${t}`).join('\n')}`
      : '',
    'Jangan anggap task ini berhasil. Lanjutkan dari langkah terakhir atau perjelas instruksinya.',
  ].filter(Boolean).join('\n');

  printBlock(report);
  journalLog({ type: 'status', status: TASK_STATUS.FAILED, reason: `loop limit ${maxLoops}`, pending: pendingCriteria.pending });
  if (threadId) {
    logStep({ threadId, role: 'assistant', content: report, actionType: 'stop', reasoning: 'Loop limit reached', verified: false });
  } else {
    logStep({ task: instruction, actionType: 'stop', detail: { verified: verifiedCount, pending: pendingCriteria.pending }, reasoning: 'Loop limit reached', verified: false });
  }
  blank();
  return report;
}
