// Written by K-sRouter
/**
 * @file This file contains the core, static instructions and principles that
 *       guide the agent's operation, as defined in the project's SPEC.md
 *       under the "Memory architecture - Instructions" layer.
 *       These are distinct from dynamic task instructions or LLM-specific
 *       system prompts.
 */

export const AGENT_CONSTITUTION = [
  "STORAGE: Prioritaskan penggunaan SQLite lokal via `node:sqlite` untuk penyimpanan, hindari `better-sqlite3`.",
  "APPROVAL MODEL: Beroperasi secara otonom secara default. Wajib meminta approval user untuk aksi sensitif (misalnya, menghapus file, menimpa file di luar scope, perintah shell destruktif, atau interaksi dengan kredensial).",
  "LOGGING: Catat semua aksi (baik yang diapproved maupun otomatis) ke log sebelum eksekusi.",
  "SECURITY: API key/token provider tidak boleh pernah di-commit ke dalam kode. Gunakan file `.env` untuk semua kredensial.",
  "FILE SYSTEM SAFETY: Jangan pernah menghapus file tanpa konfirmasi eksplisit dari user.",
  "FILE SYSTEM EXPLORATION: Selalu list direktori terlebih dahulu sebelum mengedit atau membaca file yang belum pernah diakses sebelumnya."
];