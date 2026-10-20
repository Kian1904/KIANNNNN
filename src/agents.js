// src/agents.js — Agent registry. "Agent" = config, BUKAN class.
// Nambah role = tambah entry di AGENTS, gak perlu nulis kode loop baru.
//
// Written by K-sRouter

import { ACTION_FORMAT, SYSTEM_PROMPT } from './prompts/system.js';

/**
 * @typedef {Object} AgentConfig
 * @property {string} name         - identifier unik (snake/lowercase)
 * @property {string} label        - label singkat buat UI
 * @property {string} description  - deskripsi 1 baris buat /agent
 * @property {string} persona      - system prompt spesifik role ini (TANPA blok format)
 * @property {string[]} actions    - aksi yang DIIZINKAN (subset dari parser plan.js)
 * @property {string[]|null} mcpTools - [] = tanpa MCP, null = semua MCP tool, ['a','b'] = whitelist
 * @property {number} maxLoops     - batas langkah ReAct untuk agent ini
 * @property {boolean} search      - apakah agent ini boleh web_search (aturan SEARCH_RULES ikut)
 */

// Aksi yang dikenal parser di src/plan.js (done selalu boleh, tidak perlu dicatat)
const KNOWN_ACTIONS = ['edit', 'bash', 'read', 'list_dir', 'remember', 'mcp_call', 'web_search', 'chat', 'delete', 'rename', 'move'];

/** @type {Record<string, AgentConfig>} */
export const AGENTS = {
  researcher: {
    name: 'researcher',
    label: '🔍 Researcher',
    description: 'Riset web read-only. Cuma boleh baca + web_search, gak boleh ubah apa pun.',
    persona: `Kamu adalah RESEARCHER. tugasmu SATU: mengumpulkan dan merangkum informasi dari web.
Kamu READ-ONLY — DILARANG mengubah file, menjalankan command, atau menyentuh MCP.
Kalau task butuh edit/bash, itu bukan tugasmu: selesai dengan SUMMARY yang menjelaskan temuan
risetmu, jangan memaksakan aksi di luar kapasitasmu.`,
    actions: ['read', 'list_dir', 'web_search', 'chat', 'remember'],
    mcpTools: [],      // tanpa MCP
    maxLoops: 12,
    search: true,
  },

  coder: {
    name: 'coder',
    label: '⌨️ Coder',
    description: 'Nulis & mengubah kode. Boleh edit/bash/read/MCP, tapi dilarang web_search.',
    persona: `Kamu adalah CODER. tugasmu menulis, mengubah, dan men-test kode.
Kamu BOLEH: read, list_dir, edit, bash, mcp_call, remember, chat.
Kamu DILARANG web_search — kalau butuh info eksternal, kerjakan dengan pengetahuanmu atau
selesaikan bagian yang bisa kamu kerjakan, lalu SUMMARY jelaskan asumsi yang kamu pakai.
Utamakan edit yang benar dan verifikasi lewat bash sebelum bilang done.`,
    actions: ['read', 'list_dir', 'edit', 'bash', 'mcp_call', 'chat', 'remember'],
    mcpTools: null,    // semua MCP tool
    maxLoops: 25,
    search: false,
  },

  reviewer: {
    name: 'reviewer',
    label: '🧐 Reviewer',
    description: 'Review kode read-only. Boleh baca + jalankan test/lint, tapi dilarang edit.',
    persona: `Kamu adalah REVIEWER. tugasmu MEMERIKSA kode: cari bug, masalah keamanan, dan celah.
Kamu READ-ONLY terhadap kode — DILARANG ACTION: edit.
Kamu boleh read, list_dir, dan bash (khusus untuk menjalankan test/lint/cek, BUKAN untuk merubah).
FINDINGS diurutkan: BLOCKER > WARNING > NIT. Tiap temuan sertakan path file dan alasan singkat.
Selesai dengan SUMMARY berisi daftar temuan, atau "tidak ada temuan signifikan".`,
    actions: ['read', 'list_dir', 'bash', 'chat'],
    mcpTools: [],      // tanpa MCP
    maxLoops: 12,
    search: false,
  },
};

/**
 * Ambil agent by name.
 * @param {string} name
 * @returns {AgentConfig|null}
 */
export function getAgent(name) {
  return AGENTS[name] || null;
}

/**
 * Validasi config agent (dipakai test & saat tambah role baru).
 * @param {AgentConfig} agent
 * @returns {string[]} daftar masalah; kosong = valid
 */
export function validateAgent(agent) {
  const problems = [];
  if (!agent || typeof agent !== 'object') return ['agent bukan object'];
  if (!agent.name) problems.push('name kosong');
  if (!agent.persona) problems.push('persona kosong');
  if (!Array.isArray(agent.actions) || agent.actions.length === 0) {
    problems.push('actions harus array non-kosong');
  } else {
    const unknown = agent.actions.filter(a => a !== 'done' && !KNOWN_ACTIONS.includes(a));
    if (unknown.length) problems.push(`actions mengandung nilai tak dikenal: ${unknown.join(', ')}`);
  }
  if (!(agent.mcpTools === null || Array.isArray(agent.mcpTools))) {
    problems.push('mcpTools harus null (semua) atau array');
  }
  if (!Number.isInteger(agent.maxLoops) || agent.maxLoops < 1) {
    problems.push('maxLoops harus integer >= 1');
  }
  return problems;
}

/**
 * Susun system prompt lengkap untuk agent: persona + daftar aksi boleh + blok format
 * (+ aturan search kalau agent boleh web_search) + AGENT.md opsional.
 * @param {AgentConfig} agent
 * @param {string|null} agentMd
 * @returns {string}
 */
export function composeAgentPrompt(agent, agentMd = null) {
  const allowed = agent.actions.join(', ');
  const restriction = `\n\nAksi yang BOLEH kamu pakai HANYA: ${allowed}. ACTION lain DILARANG total —
jangan memaksakan aksi di luar daftar itu. 'done' selalu boleh dipilih kapan pun.`;

  const searchRules = agent.search
    ? `\n\nAturan web_search berlaku penuh untukmu:\n${getSearchRulesText()}`
    : '';

  const full = `${agent.persona}${restriction}\n\n${ACTION_FORMAT}${searchRules}`;

  return agentMd ? `${full}\n\n## Project Instructions (AGENT.md)\n${agentMd}` : full;
}

// Ambil teks aturan search dari SYSTEM_PROMPT generic (source of truth tetap prompts/system.js)
function getSearchRulesText() {
  const marker = 'Setelah ACTION: web_search, baca snippet hasilnya.';
  const idx = SYSTEM_PROMPT.indexOf(marker);
  return idx === -1 ? '' : SYSTEM_PROMPT.slice(idx).trim();
}

/**
 * Filter pool MCP tool sesuai whitelist agent.
 * @param {Array<{name:string}>} tools
 * @param {string[]|null} mcpTools
 * @returns {Array}
 */
export function filterToolsForAgent(tools, mcpTools) {
  if (!Array.isArray(tools)) return [];
  if (mcpTools === null || mcpTools === undefined) return tools;   // semua boleh
  const allow = new Set(mcpTools);
  return tools.filter(t => allow.has(t.name));
}

export { KNOWN_ACTIONS };
