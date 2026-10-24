// M44: internal task checklist — agent wajib selesaikan semua item sebelum done diterima.
// Zero-dependency, pure state machine.

export function createTaskState(items = []) {
  const state = items.map(i => ({ id: i.id, description: i.description, status: 'pending' }));
  return {
    items: state,
    markDone(id) {
      const item = state.find(i => i.id === id);
      if (item) item.status = 'completed';
    },
  };
}

export function allCompleted(state) {
  if (!state || !Array.isArray(state.items)) return true;
  return state.items.every(i => i.status === 'completed');
}
