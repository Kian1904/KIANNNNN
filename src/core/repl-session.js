import { DESTRUCTIVE_ACTIONS, decide } from '../modes.js';

export function createApprovalController({ ask, print, approvalMode, sessionAllowed, prompt }) {
  return async function askApproval(label, { forceAsk = false } = {}) {
    const destructive = forceAsk || DESTRUCTIVE_ACTIONS.has(String(label).toLowerCase());
    const verdict = decide(approvalMode(), { action: label, isDestructive: destructive });
    if (verdict.auto) {
      print('auto', `${label} auto-approved (mode: ${approvalMode().toUpperCase()}).`);
      return { approved: true, condition: null };
    }
    if (!forceAsk && sessionAllowed.has(label)) {
      print('auto', `${label} diizinkan untuk sesi ini.`);
      return { approved: true, condition: null };
    }
    if (forceAsk) print('warn', 'Command destruktif — "allow for session" tidak tersedia.');
    const mode = approvalMode();
    if (mode === 'wellwell') print('warn', 'Aksi destruktif — mode WELL-WELL tetap minta approval.');
    console.log('  1) Allow once');
    if (!forceAsk) console.log('  2) Allow for this session');
    console.log('  3) Do not approve');
    console.log('  4) Approve with condition');
    const choice = (await ask(prompt)).trim();
    if (choice === '1') return { approved: true, condition: null };
    if (choice === '2') {
      if (forceAsk) { print('warn', 'Tidak tersedia untuk command destruktif.'); return { approved: false, condition: null }; }
      sessionAllowed.add(label);
      print('session_ok', `${label} akan auto-approved sampai /exit.`);
      return { approved: true, condition: null };
    }
    if (choice === '3') return { approved: false, condition: null };
    if (choice === '4') {
      const condition = await ask('  Ketik kondisi: ');
      console.log(`\n  Kondisi yang akan diteruskan: "${condition.trim()}"`);
      const confirm = await ask('  Lanjut? (y/n): ');
      if (confirm.trim().toLowerCase() !== 'y') return { approved: false, condition: null };
      return { approved: true, condition: condition.trim() };
    }
    print('warn', 'Input tidak valid — default: tidak diapprove.');
    return { approved: false, condition: null };
  };
}

export function createSessionStats() {
  const stats = { tasks: 0, llmCalls: 0, byProvider: {}, byAction: {} };
  return {
    stats,
    trackProvider(name) { stats.llmCalls++; stats.byProvider[name] = (stats.byProvider[name] || 0) + 1; },
    trackAction(action) { stats.byAction[action] = (stats.byAction[action] || 0) + 1; },
  };
}
