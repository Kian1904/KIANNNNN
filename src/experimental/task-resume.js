// M49: resume & crash recovery dari journal.
//
// Prinsip: resume TIDAK boleh mengulang pekerjaan yang sudah terverifikasi, dan
// TIDAK boleh melanjutkan task yang sudah terminal. Semua keputusan diambil dari
// journal aktual, bukan dari tebakan.
//
// Written by K'

import {
  TASK_STATUS, readJournal, replayJournal, isTerminalStatus,
} from './task-journal.js';

/**
 * Boleh di-resume? Hanya task non-terminal yang punya jejak journal.
 */
export function isResumable(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const entries = readJournal(filePath);
  if (entries.length === 0) return false;
  const state = replayJournal(entries);
  if (!state.status) return false;
  return !isTerminalStatus(state.status);
}

/**
 * Susun rencana resume dari journal.
 * @returns {{canResume:boolean, reason:string, status:string, goal:string,
 *            completedActions:Array, failedActions:Array, metCriteria:string[],
 *            pendingCriteria:string[], nextStep:string[], taskId:string|null}}
 */
export function planResume(filePath) {
  const empty = {
    canResume: false, reason: '', status: '', goal: '',
    completedActions: [], failedActions: [], metCriteria: [], pendingCriteria: [],
    nextStep: [], taskId: null,
  };

  if (!filePath || typeof filePath !== 'string') {
    return { ...empty, reason: 'tidak ada journal untuk task ini' };
  }
  const entries = readJournal(filePath);
  if (entries.length === 0) {
    return { ...empty, reason: 'journal kosong atau tidak terbaca' };
  }

  const state = replayJournal(entries);
  const completedActions = state.actions.filter(a => a.verified === true);
  const failedActions = state.actions.filter(a => a.verified !== true);

  const metCriteria = [];
  const pendingCriteria = [];
  for (const [id, res] of Object.entries(state.acceptance || {})) {
    if (res && res.status === 'completed' && typeof res.evidence === 'string' && res.evidence.trim()) {
      metCriteria.push(id);
    } else {
      pendingCriteria.push(id);
    }
  }

  // Langkah berikutnya: prioritaskan memperbaiki aksi yang gagal, lalu
  // melanjutkan kriteria yang belum terbukti. Aksi yang sudah verified tidak
  // pernah disarankan ulang.
  const nextStep = [];
  for (const failed of failedActions) {
    if (failed.command) nextStep.push(`perbaiki command yang gagal: ${failed.command}`);
    else if (failed.target) nextStep.push(`perbaiki aksi ${failed.action} pada ${failed.target}`);
    else if (failed.error) nextStep.push(`selesaikan aksi ${failed.action} yang gagal (${failed.error})`);
  }
  for (const id of pendingCriteria) {
    nextStep.push(`buktikan kriteria ${id} dengan aksi nyata`);
  }
  if (nextStep.length === 0 && !isTerminalStatus(state.status)) {
    nextStep.push('lanjutkan dari langkah terakhir yang tercatat di journal');
  }

  const base = {
    canResume: true,
    reason: '',
    status: state.status,
    goal: state.goal,
    completedActions,
    failedActions,
    metCriteria,
    pendingCriteria,
    nextStep,
    taskId: state.taskId,
  };

  if (isTerminalStatus(state.status)) {
    return {
      ...base,
      canResume: false,
      reason: `task sudah berstatus terminal (${state.status}) — tidak ada yang perlu dilanjutkan`,
    };
  }

  return base;
}

/**
 * Ubah rencana resume menjadi instruksi yang bisa diberikan ke runTask.
 * Instruksi ini WAJIB menyebut apa yang sudah dikerjakan supaya agent tidak
 * mengulang dari nol (dan tidak menghapus hasil kerja sebelumnya).
 */
export function buildResumeInstruction(plan) {
  if (!plan || plan.canResume !== true) return '';

  const lines = [];
  lines.push(`Lanjutkan task yang belum selesai: ${plan.goal || plan.taskId}`);
  lines.push('');
  lines.push('KONDISI SAAT INI (dibaca dari journal, bukan asumsi):');
  lines.push(`- status terakhir: ${plan.status}`);
  lines.push(`- aksi sudah terverifikasi: ${plan.completedActions.length}`);

  if (plan.completedActions.length > 0) {
    lines.push('');
    lines.push('YANG SUDAH SELESAI — JANGAN ULANG, jangan hapus hasilnya:');
    for (const a of plan.completedActions) {
      const detail = a.target || a.command || '(aksi)';
      lines.push(`- ${a.action}: ${detail}`);
    }
  }

  if (plan.failedActions.length > 0) {
    lines.push('');
    lines.push('YANG GAGAL SEBELUMNYA:');
    for (const a of plan.failedActions) {
      const detail = a.target || a.command || '(aksi)';
      lines.push(`- ${a.action}: ${detail}${a.error ? ` — ${a.error}` : ''}`);
    }
  }

  if (plan.pendingCriteria && plan.pendingCriteria.length > 0) {
    lines.push('');
    lines.push('KRITERIA YANG BELUM TERBUKTI:');
    for (const id of plan.pendingCriteria) lines.push(`- ${id}`);
  }

  lines.push('');
  lines.push('LANGKAH BERIKUTNYA:');
  for (const step of plan.nextStep) lines.push(`- ${step}`);

  lines.push('');
  lines.push('Aturan resume: jangan mengulang aksi yang sudah terverifikasi, jangan menghapus hasil kerja sebelumnya, dan jangan ACTION: done sebelum semua kriteria punya bukti aktual.');

  return lines.join('\n');
}
