// M55: shared artifact registry — worker publish, discover, consume artifacts.
//
// Kenapa ini ada: M53 memberi artifact ID + provenance, tapi belum ada cara
// worker berbagi artifact. Researcher menghasilkan evidence, coder memakainya,
// reviewer memverifikasi — tapi tidak ada registry terpusat yang melacak
// "siapa publish apa" dan "siapa pakai apa".
//
// Written by K'

let _counter = 0;
let _seq = 0;

function generateId(type) {
  _counter++;
  return `shr-${(type || 'x').slice(0, 3)}-${Date.now().toString(36)}-${_counter.toString(36)}`;
}

/**
 * Buat registry baru (in-memory).
 */
export function createSharedRegistry() {
  return {
    artifacts: new Map(),   // id -> artifact
    consumers: new Map(),   // id -> Set<workerId>
  };
}

/**
 * Publish artifact ke registry bersama.
 * @param {object} registry
 * @param {{type:string, source:string, tags?:string[], data?:object, parentIds?:string[]}} input
 * @returns {object} artifact
 */
export function publishArtifact(registry, input = {}) {
  const artifact = {
    id: generateId(input.type),
    type: input.type || 'evidence',
    source: String(input.source || ''),
    tags: Array.isArray(input.tags) ? [...input.tags] : [],
    data: input.data || {},
    parentIds: Array.isArray(input.parentIds) ? [...input.parentIds] : [],
    at: new Date().toISOString(),
    seq: ++_seq,
  };
  registry.artifacts.set(artifact.id, artifact);
  registry.consumers.set(artifact.id, new Set());
  return artifact;
}

/**
 * Cari artifact berdasarkan filter.
 * @param {object} registry
 * @param {{type?:string, tag?:string, source?:string}} filter
 * @returns {Array}
 */
export function discoverArtifacts(registry, filter = {}) {
  const all = [...registry.artifacts.values()];
  return all.filter(a => {
    if (filter.type && a.type !== filter.type) return false;
    if (filter.source && a.source !== filter.source) return false;
    if (filter.tag && !a.tags.includes(filter.tag)) return false;
    return true;
  });
}

/**
 * Catat bahwa worker mengonsumsi artifact.
 * @param {object} registry
 * @param {string} artifactId
 * @param {string} workerId
 */
export function consumeArtifact(registry, artifactId, workerId) {
  if (!registry.artifacts.has(artifactId)) return;
  if (!registry.consumers.has(artifactId)) {
    registry.consumers.set(artifactId, new Set());
  }
  registry.consumers.get(artifactId).add(workerId);
}

/**
 * Dapatkan rantai artifact dari root ke leaf (BFS dari parentIds).
 * @param {object} registry
 * @param {string} artifactId
 * @returns {Array} ordered root -> leaf
 */
export function getArtifactChain(registry, artifactId) {
  const artifact = registry.artifacts.get(artifactId);
  if (!artifact) return [];

  // Kumpulkan semua ancestor (BFS ke atas).
  const visited = new Set();
  const queue = [artifact];
  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    for (const parentId of current.parentIds || []) {
      const parent = registry.artifacts.get(parentId);
      if (parent && !visited.has(parent.id)) queue.push(parent);
    }
  }

  // Sort by timestamp (root = paling tua).
  return [...visited]
    .map(id => registry.artifacts.get(id))
    .filter(Boolean)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

/**
 * Cari artifact berdasarkan tag.
 */
export function queryByTag(registry, tag) {
  return discoverArtifacts(registry, { tag });
}

/**
 * Cari artifact berdasarkan type.
 */
export function queryByType(registry, type) {
  return discoverArtifacts(registry, { type });
}

/**
 * Hitung jumlah consumer unik dari sebuah artifact.
 */
export function getConsumerCount(registry, artifactId) {
  return (registry.consumers.get(artifactId) || new Set()).size;
}
