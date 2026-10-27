// M64: model capability routing — pilih model berdasarkan jenis task.
// Written by K'

export const MODEL_CAPABILITIES = Object.freeze({
  coding: ['coding', 'debugging', 'refactoring', 'testing'],
  research: ['research', 'analysis', 'summarization', 'web'],
  casual: ['casual', 'chat', 'translation', 'creative', 'simple'],
  review: ['review', 'security', 'quality', 'audit'],
});

const TASK_KEYWORDS = {
  coding: /\b(bikin|buat|tulis|edit|fix|perbaiki|refactor|implement|function|fungsi|class|file|code|kode|test|debug)\b/i,
  research: /\b(riset|research|cari|search|analisis|ringkas|summarize|sumber|source|web|fetch)\b/i,
  casual: /\b(halo|hai|apa|siapa|kapan|dimana|kenapa|jelaskan|terjemah|translate|cerita|puisi)\b/i,
  review: /\b(review|audit|cek|periksa|security|keamanan|kualitas|quality)\b/i,
};

export function pickBestModel(taskType, availableModels = []) {
  const caps = MODEL_CAPABILITIES[taskType];
  if (!caps) return null;
  return availableModels.find(m =>
    Array.isArray(m.capabilities) && m.capabilities.some(c => caps.includes(c))
  ) || null;
}

export function routeByCapability(instruction, availableModels = []) {
  const text = String(instruction || '');
  for (const [type, pattern] of Object.entries(TASK_KEYWORDS)) {
    if (pattern.test(text)) {
      const model = pickBestModel(type, availableModels);
      return { type, model, reason: `match ${type}` };
    }
  }
  // Default ke casual
  return { type: 'casual', model: pickBestModel('casual', availableModels), reason: 'default casual' };
}
