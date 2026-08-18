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

- [x] **M0** — Repo kosong, `package.json` zero dependency, `index.js` cuma
      print "OK". Buktiin environment Termux bersih dari masalah native module.
- [x] **M1** — CLI manggil 1 provider LLM gratisan, hasil nongol di terminal.
      Belum ada loop, belum ada file ops.
- [x] **M2** — ReAct loop minimal: read 1 file → plan → edit 1 file →
      approval y/n. Ini titik "resmi jadi agentic AI".
- [x] **M3** — SQLite (`node:sqlite`) masuk, cuma buat log percakapan dulu.
- [x] **M4** — Tambah tool `Bash` (jalanin shell command) + loop jadi iterating
      (bukan 1x jalan, agent bisa self-correct dalam 1 task sampai selesai
      atau butuh approval). SEMUA bash command wajib approval dulu, tanpa
      allowlist di versi awal — allowlist baru dipertimbangkan nanti
      berdasarkan pola command yang kebukti aman & sering dipakai.
- [x] **M5** — Provider fallback (`lib/providers.js`): urutan prioritas
      Groq → Gemini → OpenRouter → Nvidia → Mistral. Prompt (system+user)
      dikirim PERSIS SAMA ke provider manapun yang dipanggil — ini yang
      bikin task-lock otomatis (provider fallback gak tau ada provider
      sebelumnya, gak bisa "keluar jalur" dari task). Gemini butuh adapter
      terpisah karena API shape beda dari 4 provider lain (OpenAI-compatible).
      Terbukti jalan di Termux: Groq gagal (model ID salah format, kurang
      prefix vendor) → otomatis lanjut ke Gemini → task selesai. 1 bug
      logging ditemukan & fix: alasan gagal provider gak muncul di log
      per-percobaan (cuma nongol kalau SEMUA provider gagal) — sekarang
      tiap kegagalan langsung tampil detailnya.

**Catatan model ID provider (biar gak kejadian lagi):** Groq wajib pakai
prefix vendor, contoh `qwen/qwen3.6-27b` bukan `qwen3.6-27b` — model tanpa
prefix dianggap gak ketemu (404). Model gratisan/preview provider mana pun
bisa berubah/deprecated sewaktu-waktu (sudah kejadian 2x: llama-3.3-70b,
qwen3.6-27b) — makanya nama model disimpan di `.env` (`GROQ_MODEL`, dst),
bukan hardcode, biar ganti gak perlu edit code.

**FINDING dari testing M4 (belum jadi decision, dipertimbangkan buat M5+):**
approval per-command (y/n) TIDAK cukup buat nyegah typosquatting npm — user
uji install `reaact` (mirip `react`), npm sukses install (exit 0) padahal
nama itu bukan yang dimaksud. npm sendiri udah netralin versi jahatnya jadi
placeholder kosong, tapi itu keberuntungan (npm udah nangkep duluan), bukan
karena sistem kita nyegah. Approval command sebagai teks doang gak cukup
buat kasus kayak gini — perlu lapisan tambahan (cek nama package sebelum
approval, atau tampilin metadata package) kalau mau lindungin dari ini.

## Status Saat Ini — CHECKPOINT (setelah M0-M3)

**Terbukti jalan di Termux (bukan cuma sandbox), per tanggal checkpoint ini:**
- M0: environment bersih, zero dependency — OK
- M1: panggil provider Groq, respons nongol di terminal — OK
- M2: loop read→plan→diff→approval→write nyala penuh — OK
- M3: tiap approval (approve/tolak) tercatat ke SQLite (`node:sqlite`) — OK
- 1 bug nyata ditemukan & fix selama proses: parsing JSON rusak kena isi file
  multi-baris → diganti format delimiter (`===NEW_CONTENT_START/END===`).

**Keterbatasan saat ini (BUKAN bug, ini scope yang belum digarap):**
- Baru handle 1 file per instruksi, belum multi-step/multi-file dalam 1 task.
- Baru 1 provider (Groq) aktif — cascade ke Gemini/OpenRouter/Nvidia/Mistral
  BELUM diimplementasi. Kalau Groq limit habis, CLI berhenti total.
- Approval masih "tanya di semua step" — belum ada pembedaan aksi sensitif
  vs otomatis (sesuai rencana approval model, belum diimplementasi).
- Memory layer: baru Session History (`conversations`) yang jalan. Durable
  Memory belum ada tabel terpisah (decisions/learnings). Instructions
  (`AGENT.md`) dan Safety/Rollback (snapshot) masih PROPOSAL, belum dibangun.

**Next milestone (DISEPAKATI, urutan terkunci):** M4 (Bash tool + iterating
loop) dulu, baru M5 (provider fallback). Alasan urutan: Bash tool nambah
kapabilitas paling besar dengan resiko kompleksitas paling kecil; provider
fallback baru masuk akal setelah ada lebih banyak kemampuan yang "berharga
dilindungi" dari downtime 1 provider.


