// src/bash.js — Eksekusi shell command dengan guard output.
//
// maxBuffer: default Node itu 1MB. Command yang outputnya lebih dari itu
// BAKAL gagal dengan ERR_CHILD_PROCESS_STDIO_MAXBUFFER — dan errornya cryptic,
// agent gak tau kenapa. Contoh nyata: `cat` file besar, `find /`, `npm ls`.
// Dinaikin ke 16MB.
//
// TERPOTONG DI DUA TITIK (bug yang ketangkep test 2026-10-20):
//   1. Jalur GAGAL — err.stdout bisa >SEND_LIMIT.
//   2. Jalur SUKSES — ini yang kelewat! `head -c 2000000 /dev/zero` sukses
//      dengan stdout 2MB utuh dan langsung dikirim ke LLM. Bikin context
//      jebol dan tagihan token meledak. Sekarang dua-duanya dipotong.
//
// Written by K-sRouter

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Batas waktu command. Dibaca PER-PANGGILAN (bukan const waktu import) supaya
 * bisa di-override di test dan di sesi panjang.
 * Default 180s — 60s kekecengan buat install/build di HP.
 */
function timeoutMs() {
  return Number(process.env.K_SROUTER_BASH_TIMEOUT_MS) || 180_000;
}

/** Batas buffer anak proses. 1MB default Node terlalu kecil. */
function maxBuffer() {
  return Number(process.env.K_SROUTER_BASH_MAXBUFFER) || 16 * 1024 * 1024;
}

/** Kalau output masih kelewat, potong manual segini buat dikirim ke LLM. */
function sendLimit() {
  return Number(process.env.K_SROUTER_BASH_SEND_LIMIT) || 20_000;
}

/**
 * Potong teks kalau kelewat batas, plus penanda eksplisit.
 * @returns {{ text: string, cut: boolean }}
 */
function clamp(text, limit, label) {
  const s = String(text ?? '');
  if (s.length <= limit) return { text: s, cut: false };
  return {
    text: `${s.slice(0, limit)}\n[...TRUNCATED ${label}: total ${s.length} char, dikirim ${limit}]`,
    cut: true,
  };
}

export async function runCommand(command) {
  const tMs = timeoutMs();
  const tBuf = maxBuffer();
  const limit = sendLimit();

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: tMs,
      maxBuffer: tBuf,
    });

    const out = clamp(stdout.trim(), limit, 'stdout');
    const err = clamp(stderr.trim(), limit, 'stderr');

    return {
      ok: true,
      stdout: out.text,
      stderr: err.text,
      code: 0,
      truncated: out.cut || err.cut,
    };
  } catch (err) {
    const isBufferOverflow = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    const isTimeout = err.killed === true || err.signal === 'SIGTERM';

    let errText = (err.stderr || '').toString().trim();

    // Kalau kelewat buffer, err.message-nya panjang dan gak informatif.
    // Ganti jadi keterangan yang agent bisa pahami.
    if (isBufferOverflow) {
      if (!errText) {
        errText = `Output command melebihi ${Math.round(tBuf / 1024 / 1024)}MB dan dipotong. `
          + `Command kemungkinan sukses, tapi outputnya kegedean — pakai pipe (| head -n 100, | grep, | wc -l) buat mempersempit.`;
      }
    } else if (isTimeout) {
      if (!errText) {
        errText = `Command kehabisan waktu setelah ${Math.round(tMs / 1000)}s dan dihentikan.`;
      }
    } else if (!errText && err.message) {
      errText = err.message;
    }

    const out = clamp((err.stdout || '').toString().trim(), limit, 'stdout');
    const errClamped = clamp(errText, limit, 'stderr');

    return {
      ok: false,
      stdout: out.text,
      stderr: errClamped.text,
      code: err.code ?? 1,
      truncated: out.cut || errClamped.cut,
      buffered: isBufferOverflow,
      timedOut: isTimeout,
    };
  }
}
