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

- **Approval model:** 4-pilihan per aksi — (1) Allow once, (2) Allow for this
  session, (3) Do not approve, (4) Approve with condition. Session allow
  tersimpan di `Set` in-memory, reset saat `/exit`. Command yang cocok dengan
  `ALWAYS_ASK_PATTERNS` (rm, sudo, chmod, dd, npm uninstall, kill, dll) tidak
  bisa di-session-allow — selalu tanya tanpa kecuali. Semua aksi tercatat di
  log sebelum eksekusi. "Approve with condition" → kondisi diketik user,
  diinject verbatim ke history sebagai `[USER CONDITION]`, agent baca dan
  pertimbangkan di langkah berikutnya.

- **Memory architecture — 4 layer, semua IMPLEMENTED:**
  1. **Instructions** (statis, ditulis manual) — `AGENT.md` di root project.
     Dibaca saat startup, diinject ke system prompt tiap task. Kalau tidak ada,
     agent jalan tanpa layer ini.
  2. **Durable Memory** (dinamis, ditulis agent) — tabel `agent_decisions` dan
     `agent_learning`. Agent simpan keputusan via `ACTION: remember` (masuk ke
     `agent_decisions`). `agent_learning` diisi via proses distilasi otomatis
     dari `conversations` lama (target M6). Dibaca tiap task sebagai context
     lintas sesi.
  3. **Session History** (transkrip mentah) — tabel `conversations`. Semua
     langkah agent (edit, bash, read, list_dir, done, remember) tercatat per
     row. Pruning otomatis target M6.
  4. **Safety/Rollback** — SQLite snapshot isi file sebelum setiap `edit` pada
     file yang sudah ada. User bisa `/rollback <filepath>` dari chat interface
     untuk restore. Shadow git repo dipertimbangkan sebagai enhancement masa
     depan, bukan priority sekarang.

- **Action types yang tersedia agent:** `edit`, `bash`, `done`, `read`,
  `list_dir`, `remember`.

- **Chat interface (REPL):** `node index.js` masuk ke loop interaktif.
  Commands: `/exit` (keluar, hapus session allow), `/rollback [filepath]`
  (tanpa arg: list semua file yang punya snapshot; dengan arg: diff + konfirmasi
  + restore). Input yang diawali `/` tapi bukan command yang dikenal ditolak
  dengan error — tidak diteruskan ke agent.

- **Safety/Rollback implementation:** SQLite snapshot (bukan shadow git).
  Snapshot disimpan ke tabel `snapshots` sebelum `edit` — hanya kalau file
  sudah ada (file baru tidak punya snapshot karena tidak ada "sebelumnya").

## Keamanan (repo public di Github)

- API key/token provider TIDAK BOLEH pernah nempel di code yang di-commit.
- Pakai `.env` (via package `dotenv`, pure JS) buat semua credentials.
- `.gitignore` WAJIB cover `.env`, file session lokal, dan config yang isinya
  data pribadi.
- Nama model disimpan di `.env` (`GROQ_MODEL`, `GEMINI_MODEL`, dst), bukan
  hardcode — model gratisan sering deprecated tanpa notice.

## Batasan Lingkungan (Android/Termux)

- Bahasa: Node.js murni (opsional + TypeScript di atasnya — TypeScript AMAN
  ditambah kapan saja karena cuma layer type-checking, bukan ganti runtime).
  Python/Rust/C DIHINDARI karena native compile gagal/berat di Termux.
- Tool-calling: provider gratisan gak semua support native function-calling.
  Pendekatan: minta LLM balikin format terstruktur di teks biasa, parse manual.
- **PENTING — Android background process killer:** Android 12+ (termasuk
  Android 15) bisa membunuh proses Termux di background, WALAUPUN
  `termux-wake-lock` aktif. Agent HANYA reliable selagi Termux di foreground.
  Kalau mau unattended: pindah eksekusi ke VPS murah, Termux jadi SSH client.
- PROPOSAL terbuka (belum jadi decision): pertimbangkan Go untuk versi
  selanjutnya — jangan pindah bahasa sebelum ada milestone yang beneran jalan
  di Node.js.

## Cara Kerja Tim (Claude / Gemini / ChatGPT)

- Satu AI driver per unit kerja. AI lain cuma buat audit/opini kedua.
- Commit ke git tiap unit kecil selesai — jangan numpuk banyak fitur.
- Format laporan wajib tiap selesai kerja:
  **FACT** / **FINDING** / **PROPOSAL** / **DECISION** / **ACTION**.
- Jangan eksekusi/ubah/hapus file tanpa DECISION eksplisit dari user.
- Kalau state gak jelas: STOP, minta `git status` + `git log` terbaru.

## Milestone

- [x] **M0** — Repo kosong, `package.json` zero dependency, `index.js` cuma
      print "OK". Buktiin environment Termux bersih dari masalah native module.
- [x] **M1** — CLI manggil 1 provider LLM gratisan, hasil nongol di terminal.
- [x] **M2** — ReAct loop minimal: read 1 file → plan → edit 1 file →
      approval y/n. Titik "resmi jadi agentic AI".
- [x] **M3** — SQLite (`node:sqlite`) masuk, log percakapan ke tabel
      `conversations`.
- [x] **M4** — Bash tool + iterating loop (agent bisa self-correct dalam 1
      task). Semua bash wajib approval.
- [x] **M5** — Provider fallback: Groq → Gemini → OpenRouter → Nvidia → Mistral.
      Gemini butuh adapter terpisah (API shape beda). Nama model di `.env`.
- [x] **M5.5** — Chat interface (REPL loop, `/exit`, `/rollback`). Action baru:
      `read`, `list_dir`, `remember`. AGENT.md (Layer 1). `agent_decisions` +
      `agent_learning` tabel (Layer 2 foundation). Approval 4-pilihan +
      session allow + `ALWAYS_ASK_PATTERNS`. SQLite snapshot + `/rollback`
      (Layer 4).
- [ ] **M6** — Conversations pruning + distilasi otomatis. Kalau tabel
      `conversations` > 200 baris, LLM diminta ringkas pola dari 100 baris
      tertua ke `agent_learning`, lalu baris itu dihapus. Jalan otomatis di
      startup `chat()`. Buat `lib/distill.js`.
- [ ] **M7** — MCP integration. Agent bisa call tools dari MCP server eksternal.
      Mulai dari satu MCP server sederhana, test end-to-end.
- [ ] **M8** — Package safety. Tampilkan metadata npm (weekly downloads, umur
      package, publisher) sebelum approval `npm install`. Resolves FINDING
      typosquatting.

## FINDING Terbuka

**[OPEN] Model sensitivity terhadap multi-layer context:**
Model kecil (Qwen 27b via Groq) mudah confused kalau AGENT.md rules terlalu
broad + context panjang dari memory + history. Mitigasi: rules AGENT.md harus
spesifik dan scoped, hindari rule yang bisa trigger di kondisi non-relevan.
Long-term: pertimbangkan model lebih capable sebagai primary provider
(Nvidia Nemotron 550b via OpenRouter kandidat kuat — 550B param, A55B active).

**[OPEN] Typosquatting npm:**
Approval command sebagai teks tidak cukup mencegah install package salah nama.
npm sudah neutralize sebagian kasus, tapi itu luck bukan perlindungan sistem.
Perlu tampil metadata package sebelum approval. Target: M8.

**[OPEN] Snapshot hanya untuk file yang sudah ada:**
File baru tidak punya snapshot (tidak ada "sebelumnya"). Kalau agent buat file
baru lalu merusaknya, tidak bisa di-rollback. Solusi potensial: simpan snapshot
kosong ("") untuk file baru, atau tandai file baru di history.

## FINDING Resolved

**[RESOLVED] fileSnapshot dibaca agent sebagai task instruction:**
Fix: tambah label eksplisit di userPrompt (`Isi file saat ini (kalau relevan):`)
sehingga agent tidak bingung antara context file dan instruksi user.

**[RESOLVED] Memory layer 4 (rollback):**
Planned sebagai shadow git. Decision: SQLite snapshot lebih pragmatis untuk
Termux (no external deps, consistent dengan arsitektur storage yang ada).

**[RESOLVED] done action tidak ke-log:**
`ACTION: done` dulu tidak memanggil `logStep`. Fix: tambah log sebelum return.

