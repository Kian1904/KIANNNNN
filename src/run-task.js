// src/run-task.js — Handler loop agen otonom (ReAct)

import fs from 'fs';
import path from 'path';
import { askWithFallback, fallbackState } from './providers.js';
import { planStep, planStepWithRetry, buildHistoryText } from './plan.js';
import { showDiff } from './diff.js';
import { runCommand } from './bash.js';
import { logStep, saveDecision, getRecentDecisions, saveSnapshot } from './db.js';
import { callTool } from '../mcp/client.js';
import { searchWeb } from './search.js';
import { fetchWebPage, focusWebText } from './web-fetch.js'
import { verifyAction, verifyCompletion } from './verifier.js';
import { print, printBlock, sep, blank, actionIndicator } from './ui.js';
import { readFileSafe, readFileRange, listDirSafe, isSafePath } from './utils/fs.js';
import { inspectTarget, describeTarget, rejectReason, rejectWriteReason, applyFileOp, applySafeFileOp, lintAfterWrite } from './file-ops.js';
import { composeAgentPrompt, filterToolsForAgent } from './agents.js';
import { preflightEnvironment } from './environment.js';
import { createTaskBudget } from './task-budget.js';
import { delegateTask } from './delegate-cli.js';
import { createTaskState, allCompleted } from './task-state.js';
import { buildTaskContract, contractBlocksCompletion, renderContract } from './task-contract.js';
import { TASK_STATUS, createJournal, appendEntry, readJournal, replayJournal, taskPath, defaultJournalDir } from './task-journal.js';
import { decideRecovery, buildRecoveryHint } from './recovery.js';
import { detectTestRunner, buildTestCommand, parseTestOutput } from './test-orchestrator.js';
import { runReview, REVIEW_VERDICT } from './review-engine.js';
import { wrapUntrusted, scanForInjection } from './prompt-shield.js';
import { readEnv } from './env.js';
import { packetFromHistory, buildEvidenceFallback } from './research-engine.js';
import { compactResearchContext } from './research-context.js';

// M12 — Extended MAX_LOOPS
const MAX_LOOPS = parseInt(process.env.MAX_LOOPS) || 25;

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:task]', ...args); };

/**
 * M47: petakan history action aktual ke acceptance criteria kontrak.
 *
 * PRINSIP: hanya tindakan yang SUDAH terverifikasi (verified === true) yang
 * dihitung sebagai bukti. Klaim model, ringkasan, dan aksi yang gagal TIDAK
 * pernah menghasilkan bukti. Fungsi ini sengaja konservatif: lebih baik
 * menolak done daripada meloloskan klaim palsu.
 *
 * @param {Array} history - history action dari loop runTask
 * @param {object} contract - hasil buildTaskContract()
 * @returns {Array<{id:string,status:string,evidence:string}>}
 */
export function evidenceForContract(history = [], contract = null) {
  const items = Array.isArray(history) ? history : [];
  const verified = items.filter(h => h && h.verified === true);
  const failed = items.filter(h => h && h.verified === false);

  const hasEditVerified = verified.some(h => ['edit', 'write', 'append', 'mkdir'].includes(h.action));
  const hasBashOk = verified.some(h => h.action === 'bash');
  const hasWebEvidence = verified.some(h => ['web_search', 'web_fetch'].includes(h.action));
  const hasReadBack = verified.some(h => ['read', 'list_dir'].includes(h.action));
  const hasAnyFailure = failed.length > 0;

  const results = [];
  const acceptance = Array.isArray(contract?.acceptance) ? contract.acceptance : [];

  for (const criterion of acceptance) {
    let evidence = '';

    if (criterion.source === 'constraint') {
      // Constraint dibuktikan lewat dua hal: output nyata yang menunjukkan
      // kepatuhan, DAN tidak ada pelanggaran tercatat di history.
      const violation = failed.find(h => h.error && /constraint|dilarang|ditolak|blocked/i.test(String(h.error)));
      if (hasAnyFailure && violation) continue;
      if (hasEditVerified || hasBashOk) {
        evidence = `aksi terverifikasi tercatat (${verified.length}) tanpa pelanggaran constraint`;
      }
    } else if (criterion.source === 'verification') {
      if (/test/i.test(criterion.text) && hasBashOk) evidence = 'perintah test/bash sukses dengan exit code 0';
      if (/file|berkas/i.test(criterion.text) && hasEditVerified) evidence = 'file berubah dan isinya dibaca ulang';
      if (/instalasi/i.test(criterion.text) && hasBashOk) evidence = 'command instalasi sukses';
    } else if (criterion.source === 'measurement') {
      if (hasBashOk && hasReadBack) evidence = 'angka dihitung dari output command dan pembacaan file aktual';
      else if (hasBashOk) evidence = 'angka dihitung dari output command aktual';
    } else if (criterion.source === 'evidence') {
      if (hasWebEvidence) evidence = 'sumber web aktual terbaca dan terverifikasi';
    } else if (criterion.source === 'diagnosis') {
      if (hasBashOk) evidence = 'output command aktual dipakai sebagai bukti diagnosis';
    } else {
      // baseline: butuh minimal satu aksi nyata terverifikasi.
      if (hasEditVerified || hasBashOk || hasWebEvidence || hasReadBack) {
        evidence = `aksi nyata terverifikasi (${verified.length} aksi lolos pemeriksaan)`;
      }
    }

    if (evidence) results.push({ id: criterion.id, status: 'completed', evidence });
    else results.push({ id: criterion.id, status: 'pending' });
  }

  return results;
}

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
  const history = [];
  // M48: setiap aksi yang masuk history juga masuk journal. Dibungkus sekali di
  // sini supaya SEMUA jalur aksi (read/bash/edit/web/delegate/...) tercatat
  // tanpa harus menyisipkan kode journal di ~20 call site.
  const pushHistory = (item) => {
    history.push(item);
    if (item && typeof item === 'object') {
      try {
        journalLog({
          type: 'action',
          action: item.action,
          target: item.target,
          command: item.command,
          verified: item.verified === true,
          error: item.error,
          approved: item.approved,
        });
      } catch { /* journal tidak boleh mematikan task */ }
    }
    return item;
  };
  let taskState = null;
  // M47: kontrak task dibangun deterministik dari instruksi user — bukan dari
  // jawaban model. Ini yang jadi gerbang "selesai": klaim done harus punya
  // bukti untuk setiap acceptance criteria.
  const contract = agentConfig && agentConfig.contractEnabled === false
    ? { goal: '', constraints: [], acceptance: [], risk: 'low', instruction: '' }
    : buildTaskContract(instruction);
  const contractResults = new Map();
  let lastTarget = null;

  // M48: journal per task — append-only, crash-safe, di-redact.
  // Kalau env K_JOURNAL=0, journal dimatikan (dipakai test lama yang tidak mau
  // menyentuh disk). Default: aktif.
  const journalEnabled = readEnv('JOURNAL') !== '0';
  const journal = journalEnabled
    ? (() => {
        try {
          return createJournal({
            taskId: `t-${Date.now()}-${process.pid}`,
            goal: instruction,
            status: TASK_STATUS.RUNNING,
            meta: { agent: agentConfig?.name || 'generic', cwd: process.cwd(), threadId: threadId ?? null, risk: contract.risk },
          });
        } catch { return null; }
      })()
    : null;
  /** Catat ke journal tanpa pernah mengganggu jalannya task. */
  const journalLog = (entry) => {
    if (!journal) return;
    try { appendEntry(journal, entry); } catch { /* journal tidak boleh mematikan task */ }
  };
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
  const maxLoops = (agentConfig && agentConfig.maxLoops) || MAX_LOOPS;
  // M40: budget per task — search/fetch/step dibatasi deterministik, bukan
  // nunggu provider error baru sadar.
  const budget = createTaskBudget({
    maxSteps: maxLoops,
    maxSearches: parseInt(readEnv('MAX_SEARCH')) || 2,
    maxFetches: parseInt(readEnv('MAX_FETCH')) || 3,
    maxProviderCalls: parseInt(process.env.MAX_LOOPS) ? Math.min(MAX_LOOPS * 3, 30) : 15,
  });
  let systemPromptOverride = agentConfig ? composeAgentPrompt(agentConfig, agentMd) : null;

  // M47: kontrak task disuntik ke system prompt supaya model tahu definisi
  // selesai SEBELUM mulai, bukan dikoreksi belakangan setelah kerja sia-sia.
  if (contract.acceptance.length > 0) {
    const contractText = renderContract(contract);
    const contractBlock = `\n\n## KONTRAK TASK (WAJIB DIPENUHI)\n${contractText}\n\nACTION: done HANYA diterima kalau semua acceptance criteria di atas punya bukti aktual.\nKalau ada kriteria yang belum bisa dibuktikan, jangan pilih done — lakukan aksi yang membuktikannya.`;
    systemPromptOverride = `${systemPromptOverride || ''}${contractBlock}`;
    print('info', `Kontrak task: ${contract.acceptance.length} kriteria (risk: ${contract.risk})`);
  }
  const toolsForAgent = agentConfig
    ? filterToolsForAgent(availableTools, agentConfig.mcpTools)
    : availableTools;
  const allowedActions = agentConfig ? agentConfig.actions : null;
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
    if (allowedActions && step.action !== 'done' && !allowedActions.includes(step.action)) {
      blockedCount++;
      print('blocked', `Agent "${agentConfig.name}" tidak boleh ACTION: ${step.action}. Diizinkan: ${allowedActions.join(', ')}.`);
      pushHistory({
        action: 'user_condition',
        condition: `ACTION ${step.action} TIDAK DIIZINKAN untuk role ${agentConfig.name}. Pilih salah satu dari: ${allowedActions.join(', ')}, atau done.`
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
      const completion = verifyCompletion(history, step.summary);
      if (!completion.ok) {
        print('error', `Belum boleh selesai: ${completion.reason}`);
        // Jangan percaya klaim done. Minta model satu langkah koreksi/verifikasi.
        systemPromptOverride = `${systemPromptOverride || ''}\n\n[SISTEM VERIFIER: Klaim selesai DITOLAK: ${completion.reason}. Jangan ACTION: done dulu. Periksa ulang hasil aksi terakhir dan pilih aksi verifikasi/perbaikan yang konkret.]`;
        continue;
      }
      // M51: test orchestrator gate — kalau contract punya kriteria test dan
      // project punya test runner, jalankan test NYATA sebelum done diterima.
      // Hasilnya di-parse jadi structured result lalu masuk history sebagai bukti.
      const needsTest = contract.acceptance.some(a => /test/i.test(a.text));
      if (needsTest) {
        const detected = detectTestRunner({ root: process.cwd() });
        if (detected) {
          const cmd = buildTestCommand(detected);
          print('info', `M51 test orchestrator: menjalankan ${cmd}`);
          try {
            const result = await runCommand(cmd);
            const parsed = parseTestOutput(result.stdout || '', detected.runner);
            const testVerified = result.code === 0 && parsed.passed;
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
      const contractGate = contractBlocksCompletion(contract, gateResults);
      if (contractGate.blocked) {
        const pendingText = contractGate.pending.slice(0, 4).join(' | ');
        print('blocked', `Klaim selesai DITOLAK — ${contractGate.reason}.`);
        contractGate.pending.slice(0, 4).forEach(t => printBlock(`• ${t}`, 2));
        pushHistory({
          action: 'user_condition',
          condition: `[SISTEM: ACTION done DITOLAK oleh kontrak task. ${contractGate.reason}: ${pendingText}. Kamu WAJIB membuktikan kriteria ini dengan aksi nyata (bukan klaim) sebelum done.]`,
        });
        continue;
      }
      // M52: independent review — verdict berdasarkan bukti aktual, bukan klaim.
      // Reviewer memeriksa: aksi gagal disembunyikan? klaim tanpa bukti? acceptance terpenuhi?
      const review = runReview({ contract, history, summary: step.summary });
      if (review.verdict === REVIEW_VERDICT.REJECT) {
        print('blocked', `Review DITOLAK — ${review.findings.filter(f => f.severity === 'BLOCKER').length} blocker.`);
        review.findings.filter(f => f.severity === 'BLOCKER').slice(0, 4).forEach(f => printBlock(`  ✗ ${f.message}`, 2));
        journalLog({ type: 'note', text: `review: REJECT — ${review.findings.filter(f => f.severity === 'BLOCKER').map(f => f.message).join('; ')}` });
        pushHistory({
          action: 'user_condition',
          condition: `[SISTEM REVIEW: Klaim selesai DITOLAK oleh reviewer independen. ${review.findings.filter(f => f.severity === 'BLOCKER').map(f => f.message).join('; ')}. Perbaiki semua blocker sebelum ACTION: done.]`,
        });
        continue;
      }
      // Review APPROVE -> catat di journal
      journalLog({ type: 'note', text: `review: APPROVE — ${review.verifiedActions}/${review.totalActions} aksi terverifikasi` });

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
      pushHistory({ action: 'chat', reply: step.reply });
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
      const preview = r.content;
      const label = r.ok && r.totalLines > (r.end - r.start + 1)
        ? `${step.target} (baris ${r.start}-${r.end} dari ${r.totalLines})`
        : step.target;
      print('read', label);
      printBlock(preview);
      pushHistory({ action: 'read', target: step.target, content: preview, range: { start: r.start, end: r.end, total: r.totalLines } });
      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Read file: ${step.target}\n${preview}`, actionType: 'read', reasoning: step.reasoning });
      }
      continue;
    }

    // --- LIST_DIR ---
    if (step.action === 'list_dir') {
      actionIndicator('list_dir', step.target);
      const listing = listDirSafe(step.target);
      const dir = (step.target || '.').trim();
      print('list_dir', dir);
      printBlock(listing);
      pushHistory({ action: 'list_dir', target: dir, listing });
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
      pushHistory({ action: 'remember', key: step.key, value: step.value });
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
      const result = await delegateTask(step.agent, step.task, {
        cwd: process.cwd(),
        sandbox: true,
        outputFormat: 'json',
        timeoutMs: 120_000,
      });
      if (result.ok) {
        print('delegate_ok', `${step.agent}: ${result.summary.slice(0, 2000)}`);
        pushHistory({ action: 'delegate', agent: step.agent, task: step.task, summary: result.summary, artifacts: result.artifacts || [], changed_files: result.changed_files || [], tests: result.tests || [], tests_passed: result.tests_passed === true, approved: true, verified: result.verified === true });
      } else {
        print('delegate_err', `${step.agent}: ${result.error || 'gagal'}`);
        pushHistory({ action: 'delegate', agent: step.agent, task: step.task, approved: true, verified: false, error: result.error || 'gagal' });
        pushHistory({ action: 'user_condition', condition: `[SISTEM: Delegasi ke ${step.agent} GAGAL: ${result.error || 'gagal'}. Kamu WAJIB memperbaiki task atau coba pendekatan lain sebelum bilang done.]` });
      }
      continue;
    }

    // --- MCP_CALL ---
    if (step.action === 'mcp_call') {
      actionIndicator('mcp_call', step.tool);
      print('mcp', `Memanggil tool: ${step.tool}`);
      try {
        const result = await callTool(step.tool, step.toolArgs, toolsForAgent);
        print('mcp', 'Hasil:');
        printBlock(result.slice(0, 2500) + (result.length > 500 ? '...' : ''));
        pushHistory({ action: 'mcp_call', tool: step.tool, result: wrapUntrusted(result, 'mcp_call', step.tool) });
        if (threadId) {
          logStep({ threadId, role: 'assistant', content: `Called tool: ${step.tool}\nResult: ${result.slice(0, 500)}${result.length > 500 ? '...' : ''}`, actionType: 'mcp_call', detail: { tool: step.tool, result }, reasoning: step.reasoning });
        }
      } catch (err) {
        print('mcp_err', err.message);
        pushHistory({ action: 'mcp_call', tool: step.tool, result: `ERROR: ${err.message}` });
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
        const candidates = history
          .filter(h => h.action === 'web_search')
          .flatMap(h => String(h.summary || '').match(/https?:\/\/[^\s)]+/g) || []);
        const official = candidates.find(u => /bmkg\.go\.id|\.gov\.|\.go\.id\//i.test(u));
        const chosen = official || candidates[0];
        if (chosen && budget.consume('fetch')) {
          print('info', `Batas search tercapai — ambil isi sumber: ${chosen}`);
          const page = await fetchWebPage(chosen);
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
        const forcedInstruction = `${instruction}\n\n[SISTEM: Kamu sudah mencapai batas pencarian web. WAJIB ACTION: done sekarang. Tulis SUMMARY singkat dari evidence data yang sudah ada. Fokus pada angka, kondisi, lokasi, waktu, dan fakta yang menjawab pertanyaan user. Jangan menyalin menu/navigasi/URL mentah. Evidence terstruktur:\n${compactEvidence}\nDILARANG ACTION: web_search atau ACTION: mcp_call apapun di langkah ini.]`;
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
        const { provider, results } = await searchWeb(step.query);
        print('sources', results.length ? results.map(r => r.url).join('\n') : '(tidak ada hasil)');
        const summary = results
          .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join('\n\n');
        pushHistory({ action: 'web_search', query: step.query, provider, summary: wrapUntrusted(summary || '(tidak ada hasil)', 'web_search', step.query) });

        // Safety net fleksibel: kalau sudah dua search dan belum pernah membaca
        // halaman, ambil satu sumber resmi terbaik. Model tetap boleh langsung
        // done pada kasus snippet yang cukup; fetch ini hanya memastikan riset
        // data-spesifik (cuaca/harga/status) gak berhenti di daftar URL.
        if (webSearchCount >= 2 && !history.some(h => h.action === 'web_fetch') && budget.consume('fetch')) {
          const candidates = history
            .filter(h => h.action === 'web_search')
            .flatMap(h => String(h.summary || '').match(/https?:\/\/[^\s)]+/g) || []);
          const official = candidates.find(u => /bmkg\.go\.id|\.gov\.|\.go\.id\//i.test(u));
          const ordered = [...new Set([official, ...candidates].filter(Boolean))];
          let fetched = false;
          for (const chosen of ordered.slice(0, 3)) {
            print('info', `Dua search selesai — baca sumber terbaik: ${chosen}`);
            const page = await fetchWebPage(chosen);
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
        pushHistory({ action: 'user_condition', condition: `Budget web_fetch habis. Jangan fetch lagi; rangkum evidence yang sudah ada.` });
        continue;
      }
      actionIndicator('web_fetch', step.url);
      try {
        const page = await fetchWebPage(step.url);
        if (!page.ok) {
          print('search_err', `Fetch gagal (${page.error})${page.status ? ` HTTP ${page.status}` : ''}`);
          pushHistory({ action: 'web_fetch', url: step.url, summary: `ERROR: ${page.error}${page.status ? ` HTTP ${page.status}` : ''}`, verified: false, error: page.error });
        } else {
          const summary = page.text || '(halaman kosong)';
          printBlock(summary.slice(0, 800), 2);
          print('info', `Isi halaman disimpan ke history (${summary.length} karakter) — agent akan merangkum, bukan menyalin mentah.`);
          const fetchVerification = verifyAction({ action: 'web_fetch', text: summary });
          pushHistory({ action: 'web_fetch', url: page.url, summary: focusWebText(summary, instruction).slice(0, 30000), verified: fetchVerification.ok, error: fetchVerification.ok ? undefined : fetchVerification.reason });
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
        const content = step.action === 'append' ? oldContent + step.content : step.content;
        if (step.action !== 'mkdir') saveSnapshot({ filepath: step.target, content: oldContent, isNewFile: !fs.existsSync(step.target) });
        const result = applySafeFileOp(step.action, step.target, step.content);
        if (!result.ok) return `${step.action} gagal: ${result.error}`;
        // M44: auto-lint gate — cek syntax file JS setelah tulis, rollback kalau error
        if (step.action !== 'mkdir') {
          const lint = lintAfterWrite(step.target, oldContent);
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
        pushHistory({ action: step.action, target: step.target, approved: true, verified: verification.ok, error: verification.ok ? undefined : verification.reason });
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
        print('snapshot', existedBefore ? `${target} disimpan.` : `${target} (file baru) — rollback = hapus file.`);
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
      const editLint = lintAfterWrite(target, oldContent);
      if (!editLint.ok) {
        print('error', editLint.error);
        pushHistory({ action: 'edit', target, approved: true, verified: false, error: editLint.error });
        pushHistory({ action: 'user_condition', condition: buildRecoveryHint({ error: editLint.error, action: 'edit', attempt: consecutiveFailures + 1 }) });
        continue;
      }

      const editVerification = verifyAction({ action: 'edit', target, expectedContent: step.new_content, actualContent: fs.readFileSync(target, 'utf8') });
      print(editVerification.ok ? 'verify_ok' : 'error', editVerification.reason);
      print('edit_ok', `${target} ${existedBefore ? 'diupdate' : 'dibuat'}.`);
      lastTarget = target;
      pushHistory({ action: 'edit', target, approved: true, verified: editVerification.ok, error: editVerification.ok ? undefined : editVerification.reason });
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
      const desc = describeTarget(step.target, info);
      if (info.kind === 'file_binary') {
        printBlock(desc);
      } else if (step.action === 'delete' && info.content !== null && info.content !== undefined) {
        const previewLines = (info.preview || '').split('\n');
        const body = previewLines.map((l, i) => `  ${i + 1} | ${l}`).join('\n');
        printBlock(`${desc}\n\nIsi yang bakal DIHAPUS:\n${body}${info.more > 0 ? `\n  ... (${info.more} baris lagi)` : ''}`);
      } else {
        printBlock(desc);
      }
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

      const res = applyFileOp(step.action, step.target, step.dest);
      if (!res.ok) {
        print('error', `Gagal ${step.action} ${step.target}: ${res.error}`);
        pushHistory({ action: step.action, target: step.target, approved: true, error: res.error });
        return `${step.action} gagal: ${res.error}`;
      }

      const verb = step.action === 'delete' ? 'dihapus'
        : step.action === 'rename' ? `di-rename ke ${step.dest}` : `dipindah ke ${step.dest}`;
      print(`${step.action}_ok`, `${step.target} ${verb}.`);
      lastTarget = step.dest || step.target;
      pushHistory({ action: step.action, target: step.target, dest: step.dest, approved: true });
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

      const result = await runCommand(step.command);
      const bashVerification = verifyAction({ action: 'bash', result });
      print(bashVerification.ok ? 'verify_ok' : 'error', bashVerification.reason);
      print('exit_code', `${result.code}  stdout: ${result.stdout || '(kosong)'}`);
      if (result.stderr) print('stderr', result.stderr);

      if (threadId) {
        logStep({ threadId, role: 'assistant', content: `Command executed: ${step.command}\nExit code: ${result.code}\nStdout: ${result.stdout || '(kosong)'}`, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      } else {
        logStep({ task: instruction, actionType: 'bash', detail: { command: step.command, providerUsed: fallbackState.lastProvider, ...result }, reasoning: step.reasoning, approved: true });
      }
      pushHistory({ action: 'bash', command: step.command, approved: true, result, verified: bashVerification.ok, error: bashVerification.ok ? undefined : bashVerification.reason });

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
          pushHistory({ action: 'note', text: stopMsg });
          return stopMsg;
        }
        pushHistory({ action: 'user_condition', condition: buildRecoveryHint({
          error: `${result.stderr || ''} ${bashVerification.reason || ''}`,
          action: 'bash',
          attempt: consecutiveFailures,
        }) });
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
