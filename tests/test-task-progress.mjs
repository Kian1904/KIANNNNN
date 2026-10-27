// M60 RED: long-running task support — progress tracking, status report, SIGINT.
import {
  createProgressTracker, updateProgress, getProgressReport,
  shouldReport, registerSignalHandler, getRemainingEstimate,
} from '../src/task-progress.js';

let pass = 0, fail = 0;
const check = (l, c, x = '') => c ? (pass++, console.log(`  PASS ${l}`)) : (fail++, console.log(`  FAIL ${l}${x ? ' — ' + x : ''}`));

// ── [1] createProgressTracker ───────────────────────────────────────────────
{
  const t = createProgressTracker({ taskId: 'p1', totalSteps: 10, label: 'bikin API' });
  check('create: punya taskId', t.taskId === 'p1');
  check('create: totalSteps tercatat', t.totalSteps === 10);
  check('create: currentStep 0', t.currentStep === 0);
  check('create: label tercatat', t.label === 'bikin API');
  check('create: startedAt ada', typeof t.startedAt === 'number');
  check('create: history kosong', t.history.length === 0);
}

// ── [2] updateProgress ──────────────────────────────────────────────────────
{
  const t = createProgressTracker({ taskId: 'p2', totalSteps: 5 });
  updateProgress(t, { step: 1, action: 'read file' });
  check('update: currentStep naik', t.currentStep === 1);
  check('update: history bertambah', t.history.length === 1);
  check('update: action tercatat', t.history[0].action === 'read file');
  check('update: timestamp ada', typeof t.history[0].at === 'number');

  updateProgress(t, { step: 2, action: 'edit file' });
  updateProgress(t, { step: 3, action: 'run test' });
  check('update: currentStep = 3', t.currentStep === 3);
  check('update: history = 3', t.history.length === 3);
}

// ── [3] getProgressReport ───────────────────────────────────────────────────
{
  const t = createProgressTracker({ taskId: 'p3', totalSteps: 10, label: 'bikin API login' });
  updateProgress(t, { step: 3, action: 'baca file' });
  const report = getProgressReport(t);
  check('report: ada taskId', report.includes('p3'));
  check('report: ada progress', /3\/10|3.*10/.test(report));
  check('report: ada label', report.includes('bikin API login'));
  check('report: ada persentase', /\d+%/.test(report));
}
{
  const t = createProgressTracker({ taskId: 'p3b', totalSteps: 4 });
  updateProgress(t, { step: 4, action: 'selesai' });
  const report = getProgressReport(t);
  check('report: 100% saat selesai', /100%/.test(report));
}

// ── [4] shouldReport ────────────────────────────────────────────────────────
{
  const t = createProgressTracker({ taskId: 'p4', totalSteps: 10, reportInterval: 3 });
  check('shouldReport: step 0 -> false', shouldReport(t, 0) === false);
  check('shouldReport: step 3 -> true', shouldReport(t, 3) === true);
  check('shouldReport: step 5 -> false', shouldReport(t, 5) === false);
  check('shouldReport: step 6 -> true', shouldReport(t, 6) === true);
  check('shouldReport: step 10 (last) -> true', shouldReport(t, 10) === true);
}
{
  const t = createProgressTracker({ taskId: 'p4b', totalSteps: 5 });
  check('shouldReport: default interval 5 -> step 5 true', shouldReport(t, 5) === true);
  check('shouldReport: default interval 5 -> step 3 false', shouldReport(t, 3) === false);
}

// ── [5] registerSignalHandler ───────────────────────────────────────────────
{
  let called = false;
  const cleanup = registerSignalHandler(() => { called = true; });
  check('signal: returns cleanup function', typeof cleanup === 'function');
  // Cleanup tanpa crash
  try { cleanup(); check('signal: cleanup tidak crash', true); } catch { check('signal: cleanup tidak crash', false); }
}

// ── [6] getRemainingEstimate ────────────────────────────────────────────────
{
  const t = createProgressTracker({ taskId: 'p6', totalSteps: 10 });
  // Simulasi 5 step dalam 5 detik
  for (let i = 1; i <= 5; i++) {
    updateProgress(t, { step: i, action: `step ${i}`, at: Date.now() - (5 - i) * 1000 });
  }
  const est = getRemainingEstimate(t);
  check('estimate: punya remainingSteps', typeof est.remainingSteps === 'number');
  check('estimate: punya estimatedSeconds', typeof est.estimatedSeconds === 'number');
  check('estimate: remainingSteps = 5', est.remainingSteps === 5);
  check('estimate: estimatedSeconds > 0', est.estimatedSeconds > 0);
}

// ── [7] Robustness ──────────────────────────────────────────────────────────
{
  check('create: tanpa totalSteps tidak crash', typeof createProgressTracker({ taskId: 'x' }) === 'object');
  check('update: null tracker tidak crash', (() => { try { updateProgress(null, {}); return true; } catch { return false; } })());
  check('report: null tracker -> string kosong', getProgressReport(null) === '');
  check('estimate: null tracker -> object aman', typeof getRemainingEstimate(null) === 'object');
}

console.log(`\n=== HASIL TASK-PROGRESS: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
