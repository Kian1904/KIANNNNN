// src/context-compaction.js — kompres history task biar context gak meledak.
//
// Kenapa ini ada: `buildHistoryText` (plan.js) meng-include ISI FILE PENUH tiap
// langkah READ. Di task panjang (100+ langkah), history bisa jadi ratusan KB
// yang dikirim ULANG tiap iterasi — boros token, dan bisa melewati context window.
//
// Strategi (hierarchical):
//   1. Langkah TERBARU (window) → detail penuh
//   2. Langkah LAMA → diringkas jadi 1 baris (aksi + target + status)
//   3. Isi file besar → dipotong, diganti placeholder + ukuran
//
// Ini melengkapi komponen ke-13 dari checklist agent (context compaction).
//
// Written by K'

// Berapa langkah terakhir yang tetap detail penuh.
const DEFAULT_KEEP_RECENT = 8;
// Batas karakter isi file yang ditampilkan per langkah READ.
const DEFAULT_MAX_CONTENT = 2000;
// Batas total karakter hasil kompaksi (perkiraan token ≈ char/4).
const DEFAULT_MAX_TOTAL = 24000;

/**
 * Ringkas satu entry history jadi 1 baris.
 * @param {object} h
 * @param {number} idx
 * @returns {string}
 */
export function summarizeEntry(h, idx) {
  const n = idx + 1;
  switch (h.action) {
    case 'read':
      return `Langkah ${n}: READ ${h.target} (${(h.content || '').length} char)`;
    case 'list_dir':
      return `Langkah ${n}: LIST_DIR ${h.target} (${(h.listing || '').split('\n').length} entri)`;
    case 'chat':
      return `Langkah ${n}: CHAT`;
    case 'edit':
    case 'write':
    case 'append':
    case 'mkdir':
      return `Langkah ${n}: ${h.action.toUpperCase()} ${h.target} — ${h.approved ? 'diterapkan' : 'DITOLAK'}`;
    case 'delete':
    case 'rename':
    case 'move':
      return `Langkah ${n}: ${h.action.toUpperCase()} ${h.target}${h.dest ? ' → ' + h.dest : ''} — ${h.approved ? 'diterapkan' : 'DITOLAK'}`;
    case 'bash':
      return `Langkah ${n}: BASH \`${(h.command || '').slice(0, 60)}\` — ${h.error ? 'ERROR' : 'ok'}`;
    case 'web_search':
      return `Langkah ${n}: WEB_SEARCH "${(h.query || '').slice(0, 50)}"`;
    case 'web_fetch':
      return `Langkah ${n}: WEB_FETCH ${h.url}`;
    case 'mcp_call':
      return `Langkah ${n}: MCP_CALL ${h.tool}`;
    case 'delegate':
      return `Langkah ${n}: DELEGATE ${h.agent}`;
    case 'user_condition':
      // PENTING: teks user_condition sering berisi hint recovery ([RECOVERY: ...])
      // yang HARUS sampai ke model. Jangan diringkas jadi 1 baris — simpan teksnya.
      return `Langkah ${n}: USER_CONDITION — ${String(h.condition || '').slice(0, 300)}`;
    case 'note':
      return `Langkah ${n}: NOTE — ${String(h.text || h.note || '').slice(0, 200)}`;
    default:
      return `Langkah ${n}: ${String(h.action || 'unknown').toUpperCase()} ${h.target || ''}`.trim();
  }
}

/**
 * Potong isi file panjang, sisakan awal + akhir.
 * @param {string} content
 * @param {number} max
 * @returns {string}
 */
export function truncateContent(content, max = DEFAULT_MAX_CONTENT) {
  const s = String(content ?? '');
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${s.slice(0, head)}\n\n[...DIPOTONG ${s.length - max} karakter...]\n\n${s.slice(-tail)}`;
}

/**
 * Kompak history jadi teks yang hemat token.
 *
 * @param {Array} history
 * @param {object} [opts]
 * @param {number} [opts.keepRecent=8]   langkah terakhir yang tetap detail
 * @param {number} [opts.maxContent=2000] batas isi file per langkah READ
 * @param {number} [opts.maxTotal=24000]  batas total karakter
 * @returns {{ text: string, compacted: boolean, originalLength: number, finalLength: number, summarized: number }}
 */
export function compactHistory(history, opts = {}) {
  const {
    keepRecent = DEFAULT_KEEP_RECENT,
    maxContent = DEFAULT_MAX_CONTENT,
    maxTotal = DEFAULT_MAX_TOTAL,
  } = opts;

  if (!Array.isArray(history) || history.length === 0) {
    return { text: '(belum ada langkah)', compacted: false, originalLength: 0, finalLength: 0, summarized: 0 };
  }

  const cut = Math.max(0, history.length - keepRecent);
  const old = history.slice(0, cut);
  const recent = history.slice(cut);

  const parts = [];

  // Bagian lama: ringkas jadi 1 baris per langkah
  if (old.length > 0) {
    parts.push(`[RINGKASAN ${old.length} LANGKAH AWAL]`);
    for (let i = 0; i < old.length; i++) {
      parts.push(summarizeEntry(old[i], i));
    }
    parts.push('[AKHIR RINGKASAN]');
  }

  // Bagian baru: detail penuh (dengan isi file dipotong)
  for (let i = 0; i < recent.length; i++) {
    const h = recent[i];
    const n = cut + i + 1;
    if (h.action === 'read') {
      parts.push(`Langkah ${n}: READ ${h.target}\n--- ISI FILE ---\n${truncateContent(h.content, maxContent)}\n--- END ---`);
    } else if (h.action === 'list_dir') {
      parts.push(`Langkah ${n}: LIST_DIR ${h.target}\n${h.listing}`);
    } else if (h.action === 'chat') {
      parts.push(`Langkah ${n}: CHAT — "${String(h.reply || '').slice(0, 80)}"`);
    } else {
      parts.push(summarizeEntry(h, n - 1));
    }
  }

  let text = parts.join('\n');
  const originalLength = text.length;

  // Kalau masih kelewat batas total, potong bagian ringkasan lama.
  if (text.length > maxTotal && old.length > 0) {
    const recentText = parts.slice(old.length + 2).join('\n'); // buang header+ringkasan
    const budget = maxTotal - recentText.length - 100;
    if (budget > 0) {
      const summaryLines = parts.slice(1, old.length + 1);
      const kept = [];
      let used = 0;
      for (const line of summaryLines) {
        if (used + line.length > budget) break;
        kept.push(line);
        used += line.length;
      }
      const dropped = summaryLines.length - kept.length;
      text = [
        `[RINGKASAN ${old.length} LANGKAH AWAL${dropped > 0 ? ` — ${dropped} langkah awal dipotong` : ''}]`,
        ...kept,
        '[AKHIR RINGKASAN]',
        recentText,
      ].join('\n');
    }
  }

  // Kalau MASIH kelewat (mis. bagian "recent" sendiri sudah besar), potong isi
  // file di langkah recent sampai masuk batas. Ini yang bikin maxTotal benar-benar
  // dihormati walau keepRecent besar.
  if (text.length > maxTotal) {
    const perStep = Math.max(200, Math.floor((maxTotal - 500) / Math.max(1, recent.length)));
    const rebuilt = [];
    if (old.length > 0) {
      // Ringkasan lama juga bisa kelewat batas (mis. 500 langkah × 36 char = 18KB).
      // Sisakan sebagian baris ringkasan saja, sisanya jadi 1 baris "N langkah lain".
      const summaryLines = old.map((h, i) => summarizeEntry(h, i));
      const recentEstimate = recent.reduce((a, h) => a + (h.action === 'read' ? perStep + 60 : 60), 0);
      const summaryBudget = Math.max(0, maxTotal - recentEstimate - 200);
      const kept = [];
      let used = 0;
      for (const line of summaryLines) {
        if (used + line.length > summaryBudget) break;
        kept.push(line);
        used += line.length;
      }
      const dropped = summaryLines.length - kept.length;
      rebuilt.push(`[RINGKASAN ${old.length} LANGKAH AWAL${dropped > 0 ? ` — ${dropped} langkah awal dipotong` : ''}]`);
      rebuilt.push(...kept);
      rebuilt.push('[AKHIR RINGKASAN]');
    }
    for (let i = 0; i < recent.length; i++) {
      const h = recent[i];
      const n = cut + i + 1;
      if (h.action === 'read') {
        rebuilt.push(`Langkah ${n}: READ ${h.target}\n--- ISI FILE ---\n${truncateContent(h.content, perStep)}\n--- END ---`);
      } else if (h.action === 'list_dir') {
        rebuilt.push(`Langkah ${n}: LIST_DIR ${h.target}\n${String(h.listing || '').slice(0, perStep)}`);
      } else {
        rebuilt.push(summarizeEntry(h, n - 1));
      }
    }
    text = rebuilt.join('\n');
  }

  return {
    text,
    compacted: old.length > 0,
    originalLength,
    finalLength: text.length,
    summarized: old.length,
  };
}

/**
 * Estimasi jumlah token dari teks (kasar: char/4).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}
