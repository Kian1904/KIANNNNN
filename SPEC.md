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

- **Provider cascade:** xKiro (DeepSeek v4 Pro) → xKiro-Coder (Qwen3 Coder) →
  OpenRouter (Nemotron 550B) → Gemini → Mistral. Groq dikeluarkan dari primary
  karena TPM rate limit terlalu kecil untuk context yang sekarang. Semua
  provider pakai OpenAI-compatible format kecuali Gemini (adapter terpisah).
  Nama model disimpan di `.env`, bukan hardcode.

- **Approval model:** 4-pilihan per aksi — (1) Allow once, (2) Allow for this
  session, (3) Do not approve, (4) Approve with condition. Session allow
  tersimpan di `Set` in-memory, reset saat `/exit`. Command yang cocok dengan
  `ALWAYS_ASK_PATTERNS` (rm, sudo, chmod, dd, npm uninstall, kill, dll) tidak
  bisa di-session-allow — selalu tanya. "Approve with condition" → kondisi
  diketik user, diinject verbatim ke history sebagai `[USER CONDITION]`.
  Semua aksi tercatat di log sebelum eksekusi.

- **Memory architecture — 4 layer, semua IMPLEMENTED:**
  1. **Instructions** (statis, ditulis manual) — `AGENT.md` di root project.
     Dibaca saat startup, diinject ke system prompt tiap task.
  2. **Durable Memory** (dinamis, ditulis agent) — tabel `agent_decisions` dan
     `agent_learning`. Agent simpan keputusan via `ACTION: remember`. Distilasi
     otomatis dari `conversations` lama ke `agent_learning` saat row > 200
     (via `lib/distill.js`). Dibaca tiap task sebagai context lintas sesi.
  3. **Session History** (transkrip mentah) — tabel `conversations`. Semua
     langkah agent tercatat per row. Pruning otomatis via distilasi (M6).
  4. **Safety/Rollback** — SQLite snapshot isi file sebelum setiap `edit` pada
     file yang sudah ada. User bisa `/rollback <filepath>` dari chat interface.

- **Action types yang tersedia agent:** `edit`, `bash`, `done`, `read`,
  `list_dir`, `remember`, `mcp_call`.

- **Chat interface (REPL):** `node index.js` masuk ke loop interaktif.
  `node index.js --debug` masuk ke debug/inspect mode (lihat raw LLM response,
  userPrompt preview, package safety fetch step-by-step, parsed step).
  Commands: `/exit`, `/rollback [filepath]`. Input `/xxx` yang tidak dikenal
  ditolak dengan error — tidak diteruskan ke agent.

- **MCP integration:** K-sRouter sebagai MCP client. MCP server di K's Tools
  (Vercel, endpoint `/api/mcp`, JSON-RPC 2.0 over HTTP). Tool yang di-expose:
  `summarize` (5 mode: poin, detail, explain, tabel, tutorial). Discover tools
  di startup, inject ke system prompt, agent bisa call via `ACTION: mcp_call`.
  `MCP_SERVER_URL` di `.env`.

- **Package safety (M8):** Sebelum approval `npm install` atau `pkg install`,
  system fetch metadata dari npm registry. Threshold: 404 → block otomatis,
  published < 30 hari → warning, downloads < 1.000/week → warning. Known-bad
  list hardcoded (kv, cacheable). `pkg` install: cek via `apt-cache search`,
  block jika tidak ditemukan. Semua ini via `lib/package-safety.js`.

- **Safety/Rollback implementation:** SQLite snapshot (bukan shadow git).
  File baru tidak punya snapshot — hanya file yang sudah ada yang di-snapshot
  sebelum diedit.

## Keamanan (repo public di Github)

- API key/token provider TIDAK BOLEH pernah nempel di code yang di-commit.
- Pakai `.env` (via package `dotenv`, pure JS) buat semua credentials.
- `.gitignore` WAJIB cover `.env`, file session lokal, dan config pribadi.
- Nama model di `.env`, bukan hardcode — model gratisan sering deprecated.

## Batasan Lingkungan (Android/Termux)

- Bahasa: Node.js murni (opsional + TypeScript — aman ditambah kapan saja).
  Python/Rust/C DIHINDARI karena native compile gagal/berat di Termux.
- Tool-calling: provider gratisan gak semua support native function-calling.
  Pendekatan: minta LLM output format terstruktur di teks biasa, parse manual.
- **PENTING — Android background process killer:** Android 12+ bisa membunuh
  proses Termux di background. Agent HANYA reliable selagi Termux di foreground.
  Untuk unattended: pindah ke VPS, Termux jadi SSH client.
- PROPOSAL terbuka: Go untuk versi selanjutnya — jangan pindah sebelum ada
  milestone yang beneran jalan di Node.js.

## Cara Kerja Tim

- Satu AI driver per unit kerja.
- Commit ke git tiap unit kecil selesai.
- Format laporan: **FACT** / **FINDING** / **PROPOSAL** / **DECISION** / **ACTION**.
- Jangan eksekusi/ubah/hapus file tanpa DECISION eksplisit.
- Kalau state gak jelas: STOP, minta `git status` + `git log`.

## Milestone

- [x] **M0** — Environment bersih, zero dependency.
- [x] **M1** — CLI panggil 1 provider LLM, hasil nongol di terminal.
- [x] **M2** — ReAct loop: read → plan → edit → approval y/n.
- [x] **M3** — SQLite masuk, log percakapan ke tabel `conversations`.
- [x] **M4** — Bash tool + iterating loop (agent self-correct dalam 1 task).
- [x] **M5** — Provider fallback cascade (5 provider).
- [x] **M5.5** — Chat interface REPL, `/exit`, `/rollback`. Action baru: `read`,
      `list_dir`, `remember`. AGENT.md Layer 1. `agent_decisions` +
      `agent_learning` Layer 2 foundation. Approval 4-pilihan + session allow +
      `ALWAYS_ASK_PATTERNS`. SQLite snapshot + `/rollback` Layer 4.
- [x] **M6** — Conversations pruning + distilasi otomatis (`lib/distill.js`).
      Threshold 200 baris, batch 100, ringkasan ke `agent_learning`.
- [x] **M7** — MCP integration. K's Tools sebagai MCP server (Vercel).
      K-sRouter sebagai MCP client (`lib/mcp.js`). Tool `summarize` end-to-end
      working. `ACTION: mcp_call` di agent pipeline.
- [x] **M8** — Package safety (`lib/package-safety.js`). npm registry check,
      threshold block/warn, known-bad list, pkg apt-cache check. Debug mode
      (`--debug`) untuk inspect seluruh pipeline.

## Provider Cascade (current)

| Urutan | Provider | Platform | Model default |
|--------|----------|----------|---------------|
| 1 | xKiro | xkiro.com | deepseek/deepseek-v4-pro |
| 2 | xKiro-Coder | xkiro.com | qwen/qwen3-coder |
| 3 | OpenRouter | openrouter.ai | nvidia/nemotron-ultra-550b |
| 4 | Gemini | Google | gemini-2.5-flash |
| 5 | Mistral | mistral.ai | mistral-small-latest |

## FINDING Terbuka

**[OPEN] MCP result bloat context window:**
Hasil `mcp_call` yang panjang masuk ke history dan dikirim ulang ke LLM di
langkah berikutnya. Bisa trigger rate limit (terjadi di Groq). Mitigasi:
truncate MCP result di `buildHistoryText` lebih agresif, atau skip full result
dari history kalau sudah di-`done` di langkah berikutnya.

**[OPEN] Snapshot untuk file baru:**
File yang baru dibuat tidak punya snapshot (tidak ada "sebelumnya"). Rollback
tidak tersedia untuk file baru. Solusi potensial: simpan snapshot kosong untuk
file baru, atau tandai di history.

**[OPEN] Diff tidak akurat untuk file besar:**
`lib/diff.js` pakai parallel line comparison, bukan real diff algorithm. Untuk
file dengan baris yang dipindah/disisipkan, output diff-nya misleading. Target
masa depan: implementasi Myers diff algorithm atau pakai `diff` binary.

**[OPEN] Typosquatting pkg (Termux/APT):**
APT/Termux repo tidak punya public API untuk download count atau umur package.
Proteksi untuk `pkg install` cuma exist-check + known-bad list — jauh lebih
lemah dari npm check. Perlu investigasi apakah ada metadata source lain.

## FINDING Resolved

**[RESOLVED] Conversations pruning:**
Tabel `conversations` numpuk selamanya. Fix: M6 — distilasi otomatis ke
`agent_learning`, baris lama dihapus setelah diringkas.

**[RESOLVED] fileSnapshot dibaca agent sebagai task instruction:**
Fix: tambah label eksplisit `Isi file saat ini (kalau relevan):` di userPrompt.

**[RESOLVED] Memory layer 4 (rollback):**
Planned sebagai shadow git. Decision: SQLite snapshot lebih pragmatis untuk
Termux. Implemented via tabel `snapshots` + `/rollback` command.

**[RESOLVED] done action tidak ke-log:**
`ACTION: done` dulu tidak memanggil `logStep`. Fix: tambah log sebelum return.

**[RESOLVED] Model terlalu kecil sebagai primary:**
Qwen 27b via Groq confused dengan multi-layer context. Fix: xKiro (DeepSeek v4
Pro) sebagai primary, Groq dikeluarkan dari cascade.

**[RESOLVED] Nvidia model string bug:**
`defaultModel: 'poolside/laguna-xs-2.1"'` ada trailing `"`. Fix: hapus karakter
berlebih.
