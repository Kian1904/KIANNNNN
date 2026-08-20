const DISTILL_THRESHOLD = 5;  // trigger kalau conversations > ini
const DISTILL_BATCH = 100;       // ambil dan ringkas sekian baris tertua

export async function distillIfNeeded(askFn) {
  const { countConversations, getOldConversations,
          deleteConversationsByIds, saveLearningSummary } = await import('./db.js');

  const total = countConversations();
  if (total <= DISTILL_THRESHOLD) return;

  console.log(`[DISTILL] ${total} baris di conversations — mulai distilasi...`);

  const rows = getOldConversations(DISTILL_BATCH);
  const ids = rows.map(r => r.id);

  const digest = rows.map(r =>
    `task: ${r.task} | action: ${r.action_type} | reasoning: ${r.reasoning || '-'} | approved: ${r.approved}`
  ).join('\n');

  const systemPrompt = `Kamu diminta merangkum pola dari log langkah agent. Buat ringkasan singkat dalam 3-7 kalimat: pola task yang sering muncul, jenis error yang sering terjadi, dan keputusan yang konsisten dibuat. Jangan sebut nama file spesifik — fokus ke pola umum.`;
  const userPrompt = `Log langkah agent (${rows.length} baris):\n${digest}\n\nRingkas pola dari log ini.`;

  const summary = await askFn(systemPrompt, userPrompt);
  saveLearningSummary({ summary, sourceIds: ids });
  deleteConversationsByIds(ids);

  console.log(`[DISTILL] Selesai — ${rows.length} baris diringkas dan dihapus.`);
}