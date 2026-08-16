# K-sRouter-CLI — SPEC

> Dokumen ini adalah SUMBER KEBENARAN project. Semua AI (Claude/Gemini/ChatGPT)
> WAJIB baca file ini sebelum kerja apapun. Chat/history tidak dianggap sumber
> kebenaran — kalau chat dan file ini beda, file ini yang menang.

## Tujuan
Membangun agentic AI CLI otonom (setara Claude Code / Codex / Gemini CLI /
Hermes Agent) yang jalan di Termux, ditenagai LLM API gratisan (multi-provider
cascade). Setelah stabil, dihubungkan ke aplikasi profitable via MCP.

## Keputusan Arsitektur (FINAL, jangan didebat ulang tanpa alasan baru)

- **Storage:** SQLite lokal via `node:sqlite` (built-in Node, BUKAN
  `better-sqlite3` — native module itu gagal build di Termux/ARM/Bionic libc).
  Tidak migrasi ke Postgres/Turso/cloud DB manapun kecuali ada alasan teknis
  baru yang konkret.
- **Approval model:** Default otonom. Approval WAJIB cuma buat aksi sensitif
  (delete, overwrite di luar scope, shell destruktif, apapun yang nyentuh
  credentials). Semua aksi (approved maupun auto) tercatat di log, sebelum
  eksekusi jalan — bukan sesudah.
- **Memory architecture — 4 layer, jangan dicampur:**
  1. **Instructions** (statis, ditulis manual) — belum ada file-nya, next task.
  2. **Durable Memory** (dinamis, ditulis agent) — tabel `agent_decisions`,
     `agent_learning`.
  3. **Session History** (transkrip mentah, beda dari memory) — tabel
     `conversations`.
  4. **Safety/Rollback** (snapshot sebelum aksi destruktif) — BELUM ADA,
     rencana: shadow git repo terpisah ala Gemini CLI checkpointing.

## Keamanan (repo public di Github)

- API key/token provider TIDAK BOLEH pernah nempel di code yang di-commit.
- Pakai `.env` (via package `dotenv`, pure JS) buat semua credentials.
- `.gitignore` WAJIB cover `.env`, file session lokal, dan config yang isinya
  data pribadi.

## Batasan Lingkungan (Android/Termux)

- Bahasa: Node.js murni (opsional + TypeScript di atasnya — TypeScript AMAN
  ditambah kapan saja karena cuma layer type-checking, bukan ganti runtime).
  Python/Rust/C DIHINDARI karena native compile gagal/berat di Termux.
- Tool-calling: provider gratisan gak semua support native function-calling.
  Pendekatan yang dipakai: minta LLM balikin JSON terstruktur di teks biasa,
  parse manual (pola `prompt-parser.js` di repo lama, tetap valid dipakai).
- **PENTING — Android background process killer:** Android 12+ (termasuk
  Android 15) bisa membunuh proses Termux yang jalan di background, WALAUPUN
  `termux-wake-lock` aktif dan battery udah di-set "Unrestricted". Ini belum
  ada solusi bersih tanpa akses ADB/root. Konsekuensi: agent HANYA reliable
  dipakai selagi Termux di foreground (user memantau aktif). Kalau nanti mau
  agent jalan unattended di background, solusinya BUKAN akalin Termux lebih
  keras — pindah eksekusi ke VPS murah, Termux jadi SSH client doang.
- PROPOSAL terbuka (belum jadi decision): pertimbangkan Go buat versi
  selanjutnya setelah M0-M2 kelar dengan Node.js — jangan pindah bahasa
  sebelum ada satu milestone yang beneran jalan.

## Cara Kerja Tim (Claude / Gemini / ChatGPT)

- Satu AI driver per unit kerja. AI lain cuma buat audit/opini kedua, bukan
  nulis code di file yang sama di waktu yang sama.
- Commit ke git tiap unit kecil selesai — jangan numpuk banyak fitur dulu.
- Format laporan wajib tiap selesai kerja:
  **FACT** (berdasar code nyata) / **FINDING** (masalah ditemukan) /
  **PROPOSAL** (usulan) / **DECISION** (sudah disetujui user) /
  **ACTION** (perubahan yang beneran dilakukan).
- Jangan eksekusi/ubah/hapus file tanpa DECISION eksplisit dari user.
- Kalau state gak jelas: STOP, minta `git status` + `git log` terbaru. Jangan
  isi kekosongan dengan asumsi.

## Milestone (urut, jangan lompat)

- [ ] **M0** — Repo kosong, `package.json` zero dependency, `index.js` cuma
      print "OK". Buktiin environment Termux bersih dari masalah native module.
- [ ] **M1** — CLI manggil 1 provider LLM gratisan, hasil nongol di terminal.
      Belum ada loop, belum ada file ops.
- [ ] **M2** — ReAct loop minimal: read 1 file → plan → edit 1 file →
      approval y/n. Ini titik "resmi jadi agentic AI".
- [ ] **M3** — SQLite (`node:sqlite`) masuk, cuma buat log percakapan dulu.

## Status Saat Ini
Rebuild total dari nol. Repo lama (`K-sRouter-CLI` versi Termux) ditinggal
sebagai referensi, bukan basis kerja.
