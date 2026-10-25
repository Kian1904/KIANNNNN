// M50: recovery engine — klasifikasi error + kebijakan retry eksplisit.
//
// Kenapa ini dipisah dari reasoning: menyerahkan semua error ke LLM sebagai teks
// mentah membuat agent (a) retry error permanen, (b) retry aksi destruktif,
// (c) memanggil provider yang sedang cooldown, (d) loop tanpa henti.
// Engine ini memutuskan lebih dulu, baru model diberi hint yang spesifik.
//
// Written by K'

export const ERROR_KIND = Object.freeze({
  SYNTAX: 'syntax',
  TEST_FAILURE: 'test_failure',
  RATE_LIMIT: 'rate_limit',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  PERMISSION: 'permission',
  NOT_FOUND: 'not_found',
  APPROVAL_DENIED: 'approval_denied',
  CONSTRAINT: 'constraint',
  PROVIDER: 'provider',
  UNKNOWN: 'unknown',
});

const RETRYABLE = new Set([
  ERROR_KIND.SYNTAX,
  ERROR_KIND.TEST_FAILURE,
  ERROR_KIND.RATE_LIMIT,
  ERROR_KIND.TIMEOUT,
  ERROR_KIND.NETWORK,
  ERROR_KIND.NOT_FOUND,
  ERROR_KIND.PROVIDER,
]);

const PERMANENT = new Set([
  ERROR_KIND.APPROVAL_DENIED,
  ERROR_KIND.CONSTRAINT,
  ERROR_KIND.PERMISSION,
]);

// Sengaja TIDAK masuk RETRYABLE: aksi destruktif yang gagal tidak boleh
// diulang otomatis — bisa berujung efek ganda atau kehilangan data.
const NEVER_AUTO_RETRY_ACTIONS = new Set(['delete', 'rename', 'move']);

/**
 * Klasifikasi pesan/konteks error menjadi satu jenis kanonik.
 */
export function classifyError(input = {}) {
  const msg = String(input.error || input.message || '');
  const action = input.action || '';
  const command = input.command || '';
  const status = Number(input.status) || 0;

  // Urutan penting: paling spesifik dulu.
  if (/dibatalkan oleh user|ditolak user|approval.*denied|dibatalkan/i.test(msg)) return ERROR_KIND.APPROVAL_DENIED;
  if (/constraint|dilarang|melanggar larangan/i.test(msg)) return ERROR_KIND.CONSTRAINT;
  if (status === 429 || /429|rate limit|too many requests|retry-after/i.test(msg)) return ERROR_KIND.RATE_LIMIT;
  if (/EACCES|EPERM|permission denied|akses ditolak/i.test(msg)) return ERROR_KIND.PERMISSION;
  if (/ETIMEDOUT|timed? ?out|timeout/i.test(msg)) return ERROR_KIND.TIMEOUT;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|dns|ECONNREFUSED|ECONNRESET|fetch failed/i.test(msg)) return ERROR_KIND.NETWORK;
  if (/ENOENT|no such file|tidak ditemukan|not found/i.test(msg)) return ERROR_KIND.NOT_FOUND;
  if (/SyntaxError|Unexpected token|syntax error|Unexpected end of input/i.test(msg)) return ERROR_KIND.SYNTAX;
  if (/test|spec|assert|expect|exit code [1-9]|exit 1/i.test(`${msg} ${command}`)) return ERROR_KIND.TEST_FAILURE;
  if (/semua provider gagal|provider.*error|API error/i.test(msg)) return ERROR_KIND.PROVIDER;
  if (action === 'bash' && /exit|gagal/i.test(msg)) return ERROR_KIND.TEST_FAILURE;

  return ERROR_KIND.UNKNOWN;
}

export function isRetryable(kind) {
  return RETRYABLE.has(kind);
}

export function isPermanent(kind) {
  return PERMANENT.has(kind);
}

function backoffMs(attempt) {
  // 250ms, 500ms, 1000ms, 2000ms... cap 4000ms. Batasi supaya tidak bikin
  // agent terasa hang di HP.
  return Math.min(250 * Math.pow(2, Math.max(0, attempt - 1)), 4000);
}

/**
 * Putuskan tindakan recovery.
 *
 * @param {{error?:string, message?:string, action?:string, command?:string,
 *          status?:number, attempt?:number, maxAttempts?:number,
 *          providerCooldown?:boolean, repeatedKind?:boolean, destructive?:boolean}} input
 * @returns {{action:'retry'|'switch_provider'|'replan'|'stop', kind:string,
 *            delayMs:number, reason:string, retryable:boolean}}
 */
export function decideRecovery(input = {}) {
  const kind = classifyError(input);
  const attempt = Math.max(1, Number(input.attempt) || 1);
  const maxAttempts = Math.max(1, Number(input.maxAttempts) || 3);

  const stop = (reason) => ({ action: 'stop', kind, delayMs: 0, reason, retryable: false });

  // 1. Perubahan yang ditolak user / tidak sah: berhenti. Retry = melawan user.
  if (kind === ERROR_KIND.APPROVAL_DENIED) {
    return stop('aksi ditolak atau dibatalkan — tidak diulang otomatis, perlu keputusan user');
  }
  if (kind === ERROR_KIND.CONSTRAINT) {
    return { action: 'replan', kind, delayMs: 0, reason: 'pendekatan melanggar constraint — rencana harus diubah, bukan diulang', retryable: false };
  }
  if (kind === ERROR_KIND.PERMISSION) {
    return stop('akses ditolak sistem — mengulang tidak akan mengubah izin');
  }

  // 2. Aksi destruktif yang gagal: JANGAN auto-retry.
  if (input.destructive === true || NEVER_AUTO_RETRY_ACTIONS.has(input.action)) {
    return stop(`aksi ${input.action || 'destruktif'} gagal — tidak diulang otomatis karena berisiko`);
  }

  // 3. Rate limit dengan provider cooldown: ganti provider, bukan ulang yang sama.
  if (kind === ERROR_KIND.RATE_LIMIT && input.providerCooldown === true) {
    return { action: 'switch_provider', kind, delayMs: 0, reason: 'provider sedang cooldown — pakai provider lain', retryable: true };
  }

  // 4. Error jenis sama berulang: retry buta tidak membantu, naikkan ke replan.
  if (input.repeatedKind === true) {
    return { action: 'replan', kind, delayMs: 0, reason: `error ${kind} berulang — pendekatan harus diubah`, retryable: false };
  }

  // 5. Habis percobaan.
  if (attempt >= maxAttempts) {
    return stop(`batas percobaan habis (${attempt}/${maxAttempts}) untuk error ${kind}`);
  }

  // 6. Retryable -> retry dengan backoff.
  if (isRetryable(kind)) {
    return {
      action: 'retry', kind, delayMs: backoffMs(attempt),
      reason: `error ${kind} bisa dicoba lagi (percobaan ${attempt}/${maxAttempts})`,
      retryable: true,
    };
  }

  // 7. Unknown: beri satu kesempatan, lalu berhenti.
  if (attempt === 1) {
    return { action: 'retry', kind, delayMs: backoffMs(1), reason: 'error belum dikenal — satu percobaan tambahan', retryable: true };
  }
  return stop(`error tidak dikenal dan tidak membaik setelah ${attempt} percobaan`);
}

/**
 * Hint spesifik untuk model berdasarkan jenis error.
 * Tujuannya: model memperbaiki penyebab, bukan mengulang aksi yang sama.
 */
export function buildRecoveryHint(input = {}) {
  const kind = classifyError(input);
  const attempt = Math.max(1, Number(input.attempt) || 1);
  const raw = String(input.error || input.message || '').slice(0, 300);

  switch (kind) {
    case ERROR_KIND.SYNTAX:
      return `[RECOVERY: syntax error] Pesan: ${raw}\nPerbaiki sintaks file yang barusan kamu ubah: baca ulang bagian yang error, lalu perbaiki tepat di titik itu. Jangan menulis ulang seluruh file tanpa membaca dulu.`;

    case ERROR_KIND.TEST_FAILURE:
      return `[RECOVERY: test gagal] Pesan: ${raw}\nBaca output test sampai ketemu assertion yang gagal. Perbaiki penyebabnya, lalu jalankan ulang test yang sama untuk membuktikan.`;

    case ERROR_KIND.RATE_LIMIT:
      return `[RECOVERY: rate limit] Pesan: ${raw}\nProvider sedang membatasi. Kurangi panggilan: pakai hasil yang sudah ada, atau tunggu cooldown. Jangan mengulang request yang sama berulang kali.`;

    case ERROR_KIND.TIMEOUT:
      return `[RECOVERY: timeout] Pesan: ${raw}\nPerintah terlalu lama. Pecah jadi langkah lebih kecil, atau pakai batas waktu yang lebih pendek, lalu coba lagi.`;

    case ERROR_KIND.NETWORK:
      return `[RECOVERY: jaringan] Pesan: ${raw}\nSumber tidak bisa dihubungi. Coba sumber lain, atau selesaikan bagian yang tidak butuh jaringan. Jangan mengarang data.`;

    case ERROR_KIND.PERMISSION:
      return `[RECOVERY: izin ditolak] Pesan: ${raw}\nSistem menolak akses. JANGAN mencoba bypass (sudo/chmod). Berhenti dan laporkan butuh izin apa.`;

    case ERROR_KIND.NOT_FOUND:
      return `[RECOVERY: file/path tidak ada] Pesan: ${raw}\nCek dulu path sebenarnya (list_dir atau read direktori induk). Kalau memang belum ada, buat dulu. Jangan menebak nama file.`;

    case ERROR_KIND.APPROVAL_DENIED:
      return `[RECOVERY: approval ditolak] Pesan: ${raw}\nUser menolak aksi ini. JANGAN mencoba mengulanginya dengan cara lain. Berhenti dan tanyakan alternatif yang diizinkan.`;

    case ERROR_KIND.CONSTRAINT:
      return `[RECOVERY: constraint dilanggar] Pesan: ${raw}\nPendekatanmu melanggar batasan dari user. Ubah pendekatan sehingga tetap mematuhi constraint, jangan mengulangi cara yang sama.`;

    case ERROR_KIND.PROVIDER:
      return `[RECOVERY: provider gagal] Pesan: ${raw}\nProvider bermasalah. Gunakan hasil yang sudah terkumpul; jangan mengulang prompt yang sama persis berkali-kali.`;

    default:
      return `[RECOVERY: error belum dikenal, percobaan ${attempt}] Pesan: ${raw}\nSebelum mengulang, periksa dulu penyebabnya dengan membaca hasil/output aktual. Jangan mengulang aksi yang sama tanpa perubahan.`;
  }
}
