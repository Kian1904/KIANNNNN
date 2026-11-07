// M53: artifact provenance system — setiap bukti punya ID, sumber, dan jejak.
//
// Kenapa ini ada: evidence, file change, test result, dan worker result selama
// ini cuma entry history tanpa identitas. Tidak ada cara melacak "bukti ini
// datang dari mana" atau "artifact ini dipakai oleh siapa". M53 memberi setiap
// artifact ID unik, source, timestamp, dan chain provenance.
//
// Written by K'

import fs from 'fs';
import path from 'path';
import os from 'os';

export const ARTIFACT_TYPE = Object.freeze({
  EVIDENCE: 'evidence',
  FILE_CHANGE: 'file_change',
  TEST_RESULT: 'test_result',
  REVIEW: 'review',
  WORKER_RESULT: 'worker_result',
  COMMAND_OUTPUT: 'command_output',
  WEB_CONTENT: 'web_content',
});

let _counter = 0;

function generateId(type) {
  _counter++;
  return `art-${type.slice(0, 3)}-${Date.now().toString(36)}-${_counter.toString(36)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function defaultArtifactDir() {
  return path.join(os.homedir(), '.kian_data', 'artifacts');
}

/**
 * Buat artifact baru dengan ID unik, source, timestamp, dan data.
 * @param {{type: string, source: string, data?: object, dir?: string}} input
 * @returns {{id:string, type:string, source:string, data:object, at:string, provenance:string[]}}
 */
export function createArtifact(input = {}) {
  const artifact = {
    id: generateId(input.type || 'unknown'),
    type: input.type || ARTIFACT_TYPE.EVIDENCE,
    source: String(input.source || ''),
    data: input.data || {},
    at: nowIso(),
    provenance: [],
  };

  // Simpan ke disk kalau dir diberikan (opsional).
  if (input.dir) {
    try {
      fs.mkdirSync(input.dir, { recursive: true });
      fs.writeFileSync(
        path.join(input.dir, `${artifact.id}.json`),
        JSON.stringify(artifact, null, 2)
      );
    } catch { /* artifact gagal simpan tidak mematikan task */ }
  }

  return artifact;
}

/**
 * Daftar artifact dari folder.
 * @param {string} dir
 * @returns {Array} sorted by timestamp
 */
export function listArtifacts(dir = defaultArtifactDir()) {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const artifacts = files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch { return null; }
    }).filter(Boolean);
    artifacts.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return artifacts;
  } catch {
    return [];
  }
}

/**
 * Ambil artifact by ID.
 */
export function getArtifact(id, dir = defaultArtifactDir()) {
  try {
    const filePath = path.join(dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Catat bahwa `child` berasal dari `parent` (chain provenance).
 * @param {object} child - artifact yang lebih baru
 * @param {object} parent - artifact asal
 */
export function chainArtifacts(child, parent) {
  if (!child || !parent) return;
  if (!Array.isArray(child.provenance)) child.provenance = [];
  if (!child.provenance.includes(parent.id)) {
    child.provenance.push(parent.id);
  }
}

/**
 * Validasi rantai provenance: semua parent harus ada di registry.
 * @param {object} artifact
 * @param {Array} registry - daftar semua artifact yang diketahui
 * @returns {{valid: boolean, problems: string[]}}
 */
export function validateProvenance(artifact, registry = []) {
  const problems = [];
  if (!artifact || !artifact.id) {
    return { valid: false, problems: ['artifact tidak valid'] };
  }

  const knownIds = new Set(registry.map(a => a && a.id));
  for (const parentId of artifact.provenance || []) {
    if (!knownIds.has(parentId)) {
      problems.push(`parent ${parentId} tidak ditemukan di registry`);
    }
  }

  return { valid: problems.length === 0, problems };
}
