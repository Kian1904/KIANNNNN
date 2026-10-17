# K-sRouter-CLI — SPEC

> Dokumen ini adalah SUMBER KEBENARAN project. Semua AI (Claude/Gemini/Qwen/ChatGPT)
> WAJIB baca file ini sebelum kerja apapun. Chat/history tidak dianggap sumber
> kebenaran — kalau chat dan file ini beda, file ini yang menang.

## Tujuan
Membangun agentic AI CLI otonom (setara Claude Code / Codex / Gemini CLI /
Hermes Agent) yang jalan di Termux, ditenagai LLM API gratisan (multi-provider
cascade). Setelah stabil, dihubungkan ke aplikasi profitable via MCP plugin system.

## Keputusan Arsitektur (FINAL, jangan didebat ulang tanpa alasan baru)

- **Storage:** SQLite lokal via `node:sqlite` untuk conversation log dan memory.
  JSON file (`~/.krouter_data/connections.json`) untuk MCP plugin registry —
  dipilih karena human-readable dan mudah di-inspect/edit manual.

- **Provider cascade (7 provider):** xKiroCoder (Qwen3-Coder-Plus) → Gemini
  (3.1 Flash-Lite) → xKiro (DeepSeek-v4-Pro) → OpenRouter (Nemotron-550B) →
  Nvidia (Laguna) → Mistral → Groq. HuggingFace dihapus (kredit habis).
  `/model <key>` untuk switch primary. `_primaryKey` di providers.js mengatur
  urutan cascade tanpa ganti code. Model names di `.env`, bukan hardcode.
  
  **BARU — Provider Registry (2026-08-28):** Provider config sekarang disimpan
  di `~/.config/k-srouter/settings.json` (JSON array), dikelola via command `/auth`
  (add/remove/use/key). API keys plaintext dengan `chmod 600`. Atomic write
  menggunakan `.tmp` file. `src/providers.js` membaca dari registry secara dinamis.

- **Memory architecture — 4 layer, semua IMPLEMENTED:**
  1. Instructions — `AGENT.md` di root, inject ke system prompt tiap task
  2. Durable Memory — `agent_decisions` + `agent_learning`, via `ACTION: remember`
  3. Session History — tabel `conversations`, pruning otomatis via distilasi
  4. Safety/Rollback — SQLite snapshot sebelum edit, `/rollback` command

- **Action types agent:** `edit`, `bash`, `done`, `read`, `list_dir`,
  `remember`, `mcp_call`, `chat` (casual reply tanpa step ceremony)

- **Intent routing:** Sebelum `runTask`, input diklasifikasi via LLM classifier
  (`lib/intent.js`) → `casual` / `task` / `hybrid`. Casual: direct reply via
  `runCasual()`. Hybrid: casual dulu lalu tanya apakah mau eksekusi.

- **Chat interface (REPL):** `node index.js` atau `node index.js --debug`.
  Commands: `/exit`, `/rollback [filepath]`, `/model [key|list]`, `/usage`,
  `/connect` (MCP plugin manager — IN PROGRESS, lihat M10), `/auth` (provider
  manager — DONE, lihat di atas).

- **MCP architecture — IN PROGRESS (M10):**
  Plugin system berbasis registry JSON, bukan hardcode URL. Struktur folder:
  ```
  mcp/
  ├── registry.js   ✅ DONE — load/save connections.json, CRUD operations
  ├── client.js     ✅ DONE — multi-server client, replace lib/mcp.js
  └── catalog/
      ├── index.js  ⬜ TODO — known connectors catalog
      └── ktools.js ⬜ TODO — K's Tools connector
  ```
  `mcp/registry.js` sudah selesai dan siap dipakai. Langkah berikutnya:
  buat `mcp/catalog/` dan `/connect` command.

- **Package safety (M8):** `lib/package-safety.js`. npm registry check,
  threshold: 404 → block, published < 30 hari → warn, downloads < 1000/week
  → warn. Known-bad list: kv, cacheable. pkg: apt-cache search check.

- **Code style:** Pure ESM. JSDoc untuk type annotations (TS-ready — bisa
  migrate ke TypeScript kapanpun dengan rename .js → .ts + tsconfig, tanpa
  ubah logic). Tidak pakai TypeScript sekarang karena overhead di Termux.

## Keamanan
- API key/token TIDAK di-commit. Pakai `.env` via dotenv (untuk default seeding)
  atau di `settings.json` (untuk runtime provider config). `settings.json`
  di-`chmod 600` dan disimpan di `~/.config/k-srouter/`.
- `.gitignore` cover `.env`, `~/.krouter_data/` (sudah di luar repo), config pribadi.

## Batasan Lingkungan (Android/Termux)
- Node.js murni. No native modules (better-sqlite3, dll — gagal di ARM/Bionic).
- Android background killer: agent hanya reliable di foreground.

## Cara Kerja Tim
- Satu AI driver per unit kerja. Commit setelah tiap unit selesai.
- Format laporan: **FACT** / **FINDING** / **PROPOSAL** / **DECISION** / **ACTION**.
- Jangan ubah file tanpa DECISION eksplisit. Kalau state gak jelas: STOP, minta
  `git status` + `git log` + baca SPEC ini dulu.
- Kalau ada file baru yang dibuat: update SPEC ini juga.

## Struktur Folder (current — 2026-08-28 setelah restrukturisasi)
```
KIANNNNN/
├── src/                      ← Sumber utama (source of truth)
│   ├── commands/
│   │   ├── model.js         ✅ handleModel()
│   │   ├── usage.js         ✅ handleUsage(stats)
│   │   ├── connect.js       ✅ handleConnect() (MCP)
│   │   └── auth.js          ✅ handleAuth() — BARU
│   ├── prompts/
│   │   └── system.js        ✅ SYSTEM_PROMPT
│   ├── utils/
│   │   └── fs.js            ✅ readFileSafe, listDirSafe, loadAgentMd, isSafePath (security)
│   ├── run-casual.js        ✅ runCasual() — di-extract dari index.js
│   ├── run-task.js          ✅ runTask() — ReAct loop, M12 MAX_LOOPS via env
│   │                            + M14: param opsional `agentConfig` (agent ber-role)
│   ├── agents.js            ✅ M14 — Agent registry (agent = config, bukan class)
│   ├── orchestrator.js      ✅ M14 — state active-agent + runInstruction() (fan-out menyusul)
│   ├── repl.js              ✅ REPL loop & command router (+ /agent command)
│   ├── providers.js         ✅ dynamic cascade dari settings.json
│   ├── providers-registry.js ✅ load/save settings.json, atomic write, chmod 600
│   ├── db.js                ✅ SQLite
│   ├── diff.js
│   ├── distill.js
│   ├── intent.js
│   ├── package-safety.js
│   ├── plan.js
│   ├── search.js            ✅ web search (Serper→Tavily)
│   └── ui.js                ✅ TUI formatting
├── lib/                      ← Salinan dari src/ (backward compatibility, nanti dihapus)
│   ├── commands/...
│   ├── prompts/...
│   ├── utils/...
│   └── ... (salinan semua file src/)
├── mcp/                      ← MCP plugin system
│   ├── registry.js          ✅ DONE
│   ├── client.js            ✅ DONE
│   └── catalog/             ⬜ TODO
├── tests/                    ← Test files
├── bin/
│   └── kian                 ✅ executable
├── AGENT.md
├── index.js                 ✅ entry point (ramping, < 30 baris)
├── package.json
└── SPEC.md
```

## Milestone

- [x] M0 — Environment bersih, zero dependency
- [x] M1 — CLI + LLM call
- [x] M2 — ReAct loop (read→plan→edit→approval)
- [x] M3 — SQLite conversations log
- [x] M4 — Bash tool + iterating loop
- [x] M5 — Provider fallback cascade
- [x] M5.5 — Chat REPL, action types, memory 4-layer, approval 4-pilihan, rollback
- [x] M6 — Conversations pruning + distilasi (lib/distill.js)
- [x] M7 — MCP client (lib/mcp.js) + K's Tools MCP server (Vercel)
- [x] M8 — Package safety + debug mode (--debug)
- [x] M9 — TUI formatting (lib/ui.js), /model switch, /usage stats,
           intent classifier casual/task/hybrid (lib/intent.js),
           ACTION: chat untuk casual reply tanpa step ceremony
- [x] **M10 — MCP Plugin System** ✅ DONE (2026-08-28)
  - [x] `mcp/registry.js` — JSON-based plugin registry, CRUD, JSDoc typed
  - [x] `mcp/client.js` — multi-server client, replace lib/mcp.js
  - [x] `mcp/catalog/index.js` — known connectors catalog
  - [x] `mcp/catalog/ktools.js` — K's Tools connector
  - [x] `/connect` command di `src/commands/connect.js` — dashboard plugin manager
  - [x] Update index.js imports: dari lib/mcp.js → mcp/client.js
  - [ ] Delete lib/mcp.js setelah catalog selesai (pending cleanup)
- [x] **M11 — Web Search (ACTION: web_search)** ✅ DONE (2026-08-28, with fix 2026-08-30)
  - Cascade: Serper → Tavily
  - Hasil mentah tidak ditampilkan ke user
  - Agent reasoning dari hasil, output ke history
  - User lihat reasoning + sumber
  - File: `src/search.js` terintegrasi penuh
  - **Fix loop 2026-08-30:** Tambah `webSearchCount` counter, max 2 search per task, guard programmatic + prompt guidance
- [x] **M12 — Extended MAX_LOOPS** ✅ DONE (2026-08-28)
\n- [x] **M13 — Interactive TUI** ✅ DONE (2026-08-30)
  - `src/tui.js` — chat box ala Agent CLI dengan animasi typing, loading spinner, progress bar
  - Integrasi dengan `src/repl.js` via `import * as tui`
  - Global keyword activation (opsional, belum diaktifkan)
  - Semua output chat pakai `tui.agentChatBox()` bukan `printUserMessage`/`printAssistantMessage`
  - `const MAX_LOOPS = parseInt(process.env.MAX_LOOPS) || 25` di `src/run-task.js`
  - Set di `.env`: MAX_LOOPS=25
- [x] **M14 — Multi-agent PoC (role specialization)** ✅ DONE (2026-10-17)
  - Konsep: **agent = config, bukan class.** Registry `src/agents.js` berisi
    `{name, persona, actions[], mcpTools, maxLoops, search}`.
  - 3 agent bawaan: `researcher` (web-only, read-only), `coder` (edit/bash/MCP,
    dilarang web_search), `reviewer` (read-only terhadap kode, boleh bash utk test).
  - `runTask()` dapat param opsional TERAKHIR `agentConfig`. Null = generic
    (perilaku lama persis, backward compatible — REPL & Telegram gak berubah).
  - Enforcement 2 lapis: (1) filter MCP tool via `mcpTools`, (2) whitelist aksi
    programatik — aksi di luar `actions[]` diblokir, 3x berturut -> stop.
  - `src/orchestrator.js` = state active-agent + `runInstruction()`.
    Command `/agent` di REPL buat list/switch. **Fan-out (dispatch beberapa
    worker paralel) BELUM ada — itu fase berikutnya.**
  - Refactor: `src/prompts/system.js` dipecah → `ACTION_FORMAT` (dipakai ulang
    tiap agent) + `SYSTEM_PROMPT` (identik). Konstitusi kini ter-format rapi
    (bug lama: array di-toString jadi koma-lewat).
  - Test: `tests/test-agents.mjs` (35 unit, offline) +
    `tests/test-agent-integration.mjs` (4 integration, mock provider lokal,
    backup/restore `.settings.json`).
- [x] **M15 — Protokol delegasi JSON tervalidasi** ✅ DONE (2026-10-17)
  - 3 fungsi baru di `src/orchestrator.js`:
    `parsePlan(raw)` ekstrak JSON dari output LLM berisik (buang thinking tag,
    markdown fence, prose sebelum/sesudah; fallback cari `{`..`}` / `[`..`]`),
    `validatePlan(plan)` cek silang ke registry AGENTS (konsisten sama
    `validateAgent`: balik array masalah, bukan boolean), `plan(instruction)`
    orchestrate keduanya + auto-retry dengan feedback masalah dikirim balik ke LLM.
  - Protokol: `{tasks:[{id, role, brief, dependsOn}]}`. Validasi: role wajib ada
    di AGENTS (nolak role ngawang), brief non-kosong, id unik, dependsOn harus
    null/id yang ada (tolak self-ref & referensi ngawang), cap `MAX_PLAN_TASKS=4`
    (nangkep runaway loop model gratisan).
  - `plan()` pake `askWithFallback` yang sama (cascade provider), gak nambah config.
  - Return `{ok, tasks, problems, attempts, raw}` — gak throw, biar M16 bisa
    feed-back atau report.
  - Test: `tests/test-orchestrator-plan.mjs` (30 unit, tanpa network) +
    `tests/test-orchestrator-integration.mjs` (5 integration, provider asli +
    mock HTTP, backup/restore `.settings.json`).
- [x] **M16 — Fan-out eksekusi (multi-agent jalan beneran)** ✅ DONE (2026-10-17)
  - `executePlan(planResult, ctx)` di `src/orchestrator.js` — BAGIAN PENGHUBUNG
    yang sebelumnya missing. Baca hasil `plan()` -> dispatch tiap task ke
    `runTask` dengan config agent sesuai `role`, context fresh per worker.
  - `topologicalWaves(tasks)` — kelompokkan task jadi wave per `dependsOn`.
    Task dalam 1 wave independen. Cycle/dependensi ngawang -> throw (jaring
    pengaman; `validatePlan` harusnya udah nangkep duluan).
  - **Handoff dependency:** worker yang `dependsOn` task lain nerima SUMMARY
    task pendahulunya diinstruksinya (coder dapet hasil researcher).
  - **Sekuensial dalam wave, bukan paralel** — sadar: `askApproval` pakai
    readline (nggak aman interaktif barengan) + provider gratisan kena rate
    limit (paralel malah lebih lambat). Struktur wave siap kalau nanti mau
    `Promise.allSettled`.
  - Kalau `plan()` gagal (ok:false) atau tasks kosong -> sinyal `fallback:true`,
    REPL jalanin 1 task generic (perilaku lama), gak crash.
  - Command REPL baru: `/plan <task>` (dry-run, tampilkan dekomposisi doang) +
    `/squad <task>` (plan + eksekusi penuh). Input biasa TETAP single-agent
    (default lama gak berubah).
  - Test: `tests/test-squad.mjs` (8: unit topologicalWaves + integration
    executePlan handoff via mock provider, backup/restore `.settings.json`).

## Provider Cascade (aktif di `.settings.json`, urutan = prioritas cascade)

> **Dukungan no-auth (2026-10-17):** `makeOpenAICompatible` di `src/providers.js`
> kini menerima `apiKey` kosong = provider anonim tanpa kirim header `Authorization`.
> Juga fallback: kalau `message.content` kosong (model reasoning-first), ambil
> `reasoning_content`/`reasoning` biar gak jadi "empty-200" yang bikin cascade mandek.
> Backward compatible — provider ber-key tetap kirim `Bearer <key>`.

| Urutan | Key | Model | Auth |
|--------|-----|-------|------|
| 1 | groq | qwen/qwen3.8-27b | key `gsk_...` — **PRIMARY, 30 RPM (6/6 mulus saat probe)** |
| 2 | ovh-qwen | Qwen3.8-27B | **no-auth** (OVHcloud, ~2 RPM/model) |
| 3 | ovh-llama | Meta-Llama-3_3-70B-Instruct | **no-auth** |
| 4 | ovh-mistral | Mistral-Small-3.2-24B-Instruct-2506 | **no-auth** |
| 5 | pollinations | openai-fast (GPT-OSS 20B) | **no-auth**, dead-last (model lemah, OVH-backed) |

> Provider `xkiro`, `openrouter`, `nvidia`, `mistral` sudah DIHAPUS dari cascade
> (2026-10-17, permintaan user). Cascade kini 4 entry: 3 OVH no-auth + groq fallback.

**Endpoint OVHcloud (no-auth, gratis, tanpa signup/card):**
`https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` — 22 model, rate limit ~2 RPM/IP/model.
Model yang DIPAKI sudah diverifikasi balikin `content` (buang `gpt-oss-120b` yang sampah
dan `Qwen3.5-397B-A17B` yang cuma reasoning). TERVERIFIKASI end-to-end lewat
`askWithFallback`: ovh-qwen 2.2s, ovh-llama 0.36s, ovh-mistral 0.37s, groq+xkiro tetap jalan.

**Catatan cascade lama (bukan default seed lagi — lihat tabel atas untuk kondisi aktual):**
xkiro-coder, gemini, deepseek-v4-pro sempat ada tapi beberapa sudah gak aktif/dihapus.

## NEXT SESSION START POINT
**Baca ini dulu sebelum kerja apapun.**

M14 (Multi-agent PoC) + M15 (protokol JSON) + M16 (fan-out eksekusi) selesai.
Sekarang multi-agent UDAH JALAN BENERAN: `/squad <task>` ngedekomposisi task
lewat `plan()` lalu nge-dispatch ke beberapa agent (researcher/coder/reviewer)
sesuai `dependsOn`, nerusin hasil antar worker, nerakit ringkasan akhir.
Input biasa masih single-agent (default lama).

Cara test manual di REPL:
- `/plan riset cara kerja offline search lalu bikin kodenya` (lihat rencana)
- `/squad riset cara kerja offline search lalu bikin kodenya` (eksekusi penuh)
- `/agent` (lihat role), `/help` (daftar command)

Yang bisa dikerjakan berikutnya:

1. **Auto-routing:**
   - Bikin `/squad` kepanggil OTOMATIS buat task kompleks (multi-intent), tanpa
     user harus ketik `/squad`. Pakai `classifyIntent` di `src/intent.js` atau
     heuristic: task panjang / ada "lalu"/"setelah"/"riset X lalu Y" -> squad.

2. **Paralel dalam wave (optimalisasi):**
   - Setelah `askApproval` dibikin concurrency-safe (mutex/queue), tukar inner
     loop `executePlan` ke `Promise.allSettled`. Struktur wave udah siap.

3. **Surface Telegram:**
   - `src/telegram-bot.js` belum punya jalur `/squad`. Tambahin handle command
     sama biar multi-agent bisa dipakai dari Telegram juga.

4. **Tolak/validasi task besar:**
   - Task yang butuh > `MAX_PLAN_TASKS` (4) subtask — sekarang `plan()` balikin
     ok:false + feedback. Bisa ditambah auto-split jadi batch, atau guide user
     buat pecah manual.

5. **Cleanup (dari M10, masih pending):**
   - Hapus `lib/` folder + `lib/mcp.js` setelah semua import dipastikan ke `src/`.

## FINDING Terbuka

**[OPEN] logStep crash kalau threadId=null (jalur mati):**
`run-task.js` punya beberapa branch `else { logStep({task: instruction, ...}) }`
dipanggil saat `threadId=null`. Tapi `db.js logStep({threadId, role, content, ...})`
mendestructure jadi `undefined` → SQLite nolak bind param 1
(`ERR_INVALID_ARG_TYPE`). Gak pernah kejadian di produksi karena REPL & Telegram
selalu kirim threadId. Ditemukan oleh `tests/test-agent-integration.mjs`.
Fix: buang branch `{task:...}` atau bikin `logStep` handle shape itu.

**[RESOLVED] lib/mcp.js masih aktif dipakai:**
Sudah diganti dengan mcp/client.js, import di index.js sudah update. `lib/mcp.js`
masih ada tapi tidak dipakai — akan dihapus setelah catalog selesai.

**[OPEN] Diff tidak akurat untuk file besar:**
lib/diff.js pakai parallel line comparison, bukan Myers diff.

**[OPEN] Snapshot untuk file baru:**
File baru tidak punya snapshot — rollback tidak tersedia.

**[RESOLVED] Agent loop 10x untuk task mcp sederhana:**
Auto-done setelah single mcp_call kalau tidak ada continue-words di instruksi.

**[RESOLVED] Typosquatting pkg (APT/Termux):**
Sudah diimplementasi di lib/package-safety.js dengan Levenshtein distance.

**[RESOLVED] Agent bisa baca .env dan file sensitif:**
isSafePath() di lib/utils/fs.js sudah diperbaiki dengan path containment + blocklist.

**[RESOLVED] Provider config hardcode di providers.js:**
Sekarang dynamic dari settings.json via providers-registry.js dan /auth command.