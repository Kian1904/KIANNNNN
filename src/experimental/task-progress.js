// M60: long-running task support — progress tracking, status report, SIGINT.
//
// Kenapa ini ada: task panjang (5+ menit) tidak punya indikasi progress.
// User tidak tahu sampai mana pekerjaan, tidak bisa cek status, dan kalau
// Termux mati di tengah, tidak ada yang tahu task masih jalan atau tidak.
//
// Written by K'

const DEFAULT_REPORT_INTERVAL = 5; // lapor setiap 5 step

/**
 * Buat progress tracker baru.
 * @param {{taskId:string, totalSteps?:number, label?:string, reportInterval?:number}} input
 * @returns {object}
 */
export function createProgressTracker(input = {}) {
  return {
    taskId: input.taskId || `p-${Date.now().toString(36)}`,
    totalSteps: Number.isInteger(input.totalSteps) && input.totalSteps > 0 ? input.totalSteps : 0,
    currentStep: 0,
    label: input.label || '',
    reportInterval: Number.isInteger(input.reportInterval) && input.reportInterval > 0
      ? input.reportInterval
      : DEFAULT_REPORT_INTERVAL,
    startedAt: Date.now(),
    history: [],
  };
}

/**
 * Update progress tracker.
 * @param {object} tracker
 * @param {{step:number, action:string, at?:number}} update
 */
export function updateProgress(tracker, update = {}) {
  if (!tracker) return;
  tracker.currentStep = Math.max(tracker.currentStep, Number(update.step) || 0);
  tracker.history.push({
    step: update.step || tracker.currentStep,
    action: String(update.action || ''),
    at: update.at || Date.now(),
  });
}

/**
 * Generate laporan progress yang bisa dibaca manusia.
 * @param {object} tracker
 * @returns {string}
 */
export function getProgressReport(tracker) {
  if (!tracker) return '';
  const total = tracker.totalSteps || 0;
  const current = tracker.currentStep;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const elapsed = Date.now() - tracker.startedAt;
  const elapsedSec = Math.round(elapsed / 1000);

  const lines = [
    `Task: ${tracker.taskId}${tracker.label ? ` — ${tracker.label}` : ''}`,
    `Progress: ${current}/${total || '?'} (${pct}%)`,
    `Elapsed: ${elapsedSec}s`,
    `Langkah terakhir: ${tracker.history.length > 0 ? tracker.history[tracker.history.length - 1].action : '-'}`,
  ];
  return lines.join('\n');
}

/**
 * Apakah perlu lapor progress pada step ini?
 * Lapor setiap `reportInterval` step, dan selalu lapor di step terakhir.
 * @param {object} tracker
 * @param {number} step
 * @returns {boolean}
 */
export function shouldReport(tracker, step) {
  if (!tracker) return false;
  const interval = tracker.reportInterval || DEFAULT_REPORT_INTERVAL;
  if (tracker.totalSteps > 0 && step >= tracker.totalSteps) return true; // step terakhir
  return step > 0 && step % interval === 0;
}

/**
 * Register signal handler untuk graceful shutdown (SIGINT/SIGTERM).
 * Mengembalikan cleanup function yang perlu dipanggil saat selesai.
 *
 * @param {Function} onSignal - callback saat signal diterima
 * @returns {Function} cleanup
 */
export function registerSignalHandler(onSignal = () => {}) {
  const handler = () => {
    try { onSignal(); } catch { /* signal handler tidak boleh crash */ }
    process.exit(0);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  return () => {
    process.removeListener('SIGINT', handler);
    process.removeListener('SIGTERM', handler);
  };
}

/**
 * Estimasi waktu tersisa berdasarkan kecepatan step sejauh ini.
 * @param {object} tracker
 * @returns {{remainingSteps:number, estimatedSeconds:number, stepsPerSecond:number}}
 */
export function getRemainingEstimate(tracker) {
  if (!tracker || tracker.history.length < 2) {
    return {
      remainingSteps: tracker ? Math.max(0, (tracker.totalSteps || 0) - tracker.currentStep) : 0,
      estimatedSeconds: 0,
      stepsPerSecond: 0,
    };
  }

  const first = tracker.history[0];
  const last = tracker.history[tracker.history.length - 1];
  const elapsedMs = (last.at || Date.now()) - (first.at || Date.now());
  const stepsDone = tracker.history.length;
  const stepsPerSecond = elapsedMs > 0 ? (stepsDone / (elapsedMs / 1000)) : 0;
  const remainingSteps = Math.max(0, (tracker.totalSteps || 0) - tracker.currentStep);
  const estimatedSeconds = stepsPerSecond > 0 ? Math.round(remainingSteps / stepsPerSecond) : 0;

  return { remainingSteps, estimatedSeconds, stepsPerSecond: Math.round(stepsPerSecond * 100) / 100 };
}
