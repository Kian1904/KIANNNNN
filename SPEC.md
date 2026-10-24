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
├── tests/                    ← Test files (14 file, suite 163 pass)
│   ├── helpers/
│   │   └── mock-mcp-server.mjs  ✅ mock MCP Streamable HTTP (JSON+SSE)
│   ├── test-mcp.mjs         ✅ live-check; SKIP exit 0 kalau environment mati
│   └── test-mcp-client.mjs  ✅ kontrak client vs mock (self-contained, 24 pass)
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

- [x] **M17 — Telegram Squad + hardening** ✅ DONE (2026-10-18)
  - `src/approval.js` (baru): `isDangerous` + `ALWAYS_ASK_PATTERNS` diekstrak dari
    `repl.js` — aturan approval REPL & Telegram kini SATU sumber (single source of
    truth), gak mungkin beda perilaku.
  - `executePlan(planResult, ctx, deps?)` — **error isolation per worker**:
    worker yang melempar error DIKARANTINA jadi summary `"TASK GAGAL: <err>"`,
    task lain + dependency turunan TETAP lanjut (dulu: 1 crash = squad mati).
    Param `deps` ke-3 = inject `runTask` palsu buat test.
  - `src/telegram-bot.js` **di-rewrite penuh** — factory `createTelegramBot(deps)`
    (semua dependency injectable, produksi = default modul asli):
    - SEMUA instruksi lewat `runInstruction` (orchestrator), bukan `runTask`
      telanjang. Sebelum M17 bot ini cacat dobel: (a) gak punya /agent /plan
      /squad (b) `askApproval` gak pernah dikirim → **CRASH
      `askApproval is not a function`** tiap agent minta edit/bash dari HP.
    - Command setara REPL: `/agent [nama|off]`, `/plan <task>` (dry-run),
      `/squad <task>` (plan + eksekusi, fallback ke single-agent PERSIS REPL),
      `/stats`, `/clear`, `/help`, `/start`.
    - **Approval via balasan chat**: `y` (sekali) / `s` (sesi, gak tersedia utk
      destruktif) / `n` / `c <kondisi>`; timeout `APPROVAL_TIMEOUT_MS` (120s) →
      auto-reject. Pesan asing saat nunggu izin → reminder, BUKAN diproses jadi
      instruksi.
    - Anti-deadlock: jawaban approval dicek PALING AWAL di `handleMessage`
      (sebelum busy-gate); polling fire-and-forget — loop `getUpdates` TIDAK
      PERNAH mati nunggu approval/task.
    - Busy gate: 1 task besar / 1 waktu — pesan ke-2 kena "tunggu", gak pernah
      2 task LLM paralel (single-user bot).
    - Allowlist user: pesan dari ID di luar daftar dibungkam total (bot privat).
    - Entry: `node src/telegram-bot.js` (main-guard `pathToFileURL`); polling
      mode — gak butuh IP publik.
  - Test BARU `tests/test-telegram.mjs`: **26 pass** — isApprovalAnswer,
    routing /help /agent /plan /squad /stats, allowlist, argumen runInstruction,
    approval y/n/reminder, busy gate. Fetch + LLM **full mock — offline**.
    `tests/test-squad.mjs` + case [3] error isolation → **12 pass**.
  - Full suite 2026-10-19: **163 pass, 0 fail, 14/14 file exit=0** (test-mcp
    kini SKIP-exit-0 kalau environment mati + jalur MCP beneran ke-cover sama
    `test-mcp-client.mjs` — lihat FINDING MCP).

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

## M18 — UI Upgrade, Streaming, npm Global, MCP Catalog (2026-10-20)

Empat kerjaan, semuanya udah terverifikasi (test), bukan klaim kosong.

### 1. Streaming response (`src/providers.js` + `src/run-casual.js`)
- `makeOpenAICompatible` sekarang nerima argumen ketiga **opsional** `onToken`.
  **Signature `ask(systemPrompt, userPrompt)` TETAP sama** — kalau `onToken`
  gak dikasih, jalurnya masih `await res.json()` kayak dulu. Ini sengaja:
  biar test lama yang nge-mock `askWithFallback` gak pecah.
- Kalau `onToken` dikasih → POST pakai `stream: true`, baca SSE
  (`data: {...}` per baris), tiap `choices[0].delta.content` dipanggil ke
  `onToken`, dan **full text tetep di-return** (biar caller lama aman).
- Dukungan provider non-SSE: kalau `Content-Type` bukan `text/event-stream`,
  fallback baca JSON penuh lalu kirim sekali ke `onToken`.
- **BUG NYATA YANG KETEMU & DIBENERIN:** dulu URL dibangun pakai concat string
  (`baseUrl + '/chat/completions'`). Kalau `baseUrl` punya query string
  (mis. `http://host/?mode=reasoning-only`), hasilnya jadi
  `http://host/?mode=reasoning-only/chat/completions` — query rusak.
  Sekarang pakai `new URL()` + `pathname` (query dipertahankan, `/chat/completions`
  digabung ke path). Ini fix bug lama, bukan cuma buat streaming.
- `src/run-casual.js`: reply casual sekarang stream kata-per-kata ke stdout.
  Blok ` thinking...</think>` **disaring real-time** (ditahan sampai ketemu
  penanda tutup, sisanya baru dicetak). Tombol matiin: `K_SROUTER_STREAM=0`.
- `run-task.js` **sengaja TIDAK** di-streaming: output-nya terstruktur per-step
  (label + diff + approval), kalau di-stream malah bikin berantakan.

### 2. npm global (`package.json` + `bin/kian`)
- `package.json` dikasih field `bin`: `kian` dan `ksrouter` → `./bin/kian`.
  Tanpa field ini `npm link` gak bikin command apa-apa.
- `npm link` udah dijalanin. Verifikasi: `which kian` →
  `/data/data/com.termux/files/usr/bin/kian` (symlink ke
  `../lib/node_modules/k-srouter-cli/bin/kian`), dan `kian` dipanggil dari
  luar repo (`cd /tmp`) → banner + REPL jalan normal.
- Command `kian` bisa dipakai dari folder manapun tanpa `cd ~/KIANNNNN` dulu.

### 3. MCP catalog (`mcp/catalog/`)
- `ktools.js` — entry connector `id: 'ktools'`, `url: null` (URL **wajib dari
  env `MCP_SERVER_URL`**, gak boleh hardcode di source biar aman di-commit).
- `index.js` — export `CATALOG`, `resolveCatalog(env)`, `findInCatalog(id)`.
  `resolveCatalog` buang entry yang env-nya belum diisi → user gak ditawarin
  connector mati.
- `src/commands/connect.js` di-upgrade pakai `resolveCatalog()` (dulu pakai
  `CATALOG` mentah yang masih ada `c.url &&` — jadi entry env-based kekalik skip),
  plus subcommand baru:
  - `/connect catalog` → daftar connector yang env-nya udah siap
  - `/connect catalog add <id>` → tambahin connector dari catalog
- `mcp/catalog/mcp-catalog-index.js` (file duplikat lama, gak di-import siapa pun)
  **dihapus**.

### 4. Test baru
- `tests/test-streaming.mjs` (106 baris) — **12 pass**: mock SSE server nyata
  (`tests/helpers/mock-sse-server.mjs`, zero-dep `node:http`), ngecek jalur
  streaming real (chunk-per-chunk, urutan chunk, full text di-return,
  fallback provider non-SSE, URL query string gak rusak, mode reasoning-only
  tetep throw kalau kosong). **Self-contained**: nyalin repo ke tmp sebelum
  import, jadi `.settings.json` asli gak ke-overwrite.
- `tests/test-mcp-catalog.mjs` (16 pass) — ngecek env kosong → entry dibuang,
  env terisi → entry lengkap, `envKeyVar` kebaca, `findInCatalog`, dan
  file duplikat udah gak ada.

**Catatan verifikasi:** blok "12 pass / 16 pass" ini udah dijalanin beneran
dan itu output asli, bukan estimasi.

### 5. Mode approval (`src/modes.js`) — SAFE / WELL-WELL / YOLO (2026-10-20)

Satu modul aturan, dipakai BERSAMA oleh REPL dan bot Telegram — biar perilaku
dua surface gak bisa beda. Dulu aturan approval cuma ada di `askApproval`
masing-masing file, jadi rawan divergen.

| Mode | edit | bash biasa | delete/rename/move | rm/sudo/dd/kill |
|---|---|---|---|---|
| `safe` (default) | tanya | tanya | tanya | tanya |
| `wellwell` | auto | auto | **tanya** | **tanya** |
| `yolo` | auto | auto | auto | auto |

- `decide(mode, { action, isDestructive })` balikin `{ auto, approved, reason }`.
  `auto:false` = caller WAJIB nanya manual kayak biasa.
- **Fail-closed:** mode gak dikenal / `undefined` → jatuh ke `safe`. Gak ada
  jalur di mana typo mode bikin aksi destruktif lolos.
- **Invariant yang dikunci test:** SAFE dan WELL-WELL **tidak pernah**
  auto-approve aksi destruktif. Diuji eksplisit lewat matriks 2 mode × 4 aksi
  destruktif + forceAsk dari `isDangerous()`.
- Command: `/mode` (lihat), `/mode safe|wellwell|yolo` (ganti). Alias:
  `ww`, `well-well`, `terabas`, `normal`, `default`.
- Ganti mode → `sessionAllowed` di-`clear()`, biar izin "allow for session"
  dari mode sebelumnya gak kebawa.
- Env override saat start: `K_SROUTER_MODE=wellwell`. Default tetap SAFE.
- YOLO kasih banner peringatan eksplisit di REPL + Telegram.
- Aksi destruktif dideteksi dari dua sumber: label aksi (`DESTRUCTIVE_ACTIONS`:
  delete/rename/move/remove) **dan** `forceAsk` yang dikirim `run-task.js`
  hasil `isDangerous(command)` (regex `rm`/`sudo`/`dd`/`chmod`/`kill`/uninstall).
- Test: `tests/test-modes.mjs` — **50 pass** (normalisasi alias, matriks
  keputusan, fail-closed, invariant destruktif, dan cek integrasi bahwa REPL +
  Telegram dua-duanya beneran import & panggil `decide`).

### 6. Auto-routing ke squad (`src/routing.js`) — 2026-10-20

Heuristik teks murni, **sengaja gak manggil LLM** — manggil LLM buat nentuin
"pake LLM lagi apa enggak" itu kontraproduktif: ongkosnya sama kayak langsung
ngerjain, tapi tanpa kepastian.

**Cara kerja:** kumpulin sinyal teks, terus cocokin ke aturan berurutan.

Sinyal yang dilacak:
- `sequences` — penanda ada ≥2 tahap ("lalu", "terus", "setelah itu", "then")
- `cross` — lintas disiplin ("riset ... bikin", "analisis ... implement")
- `research` — kata riset mendalam ("riset", "benchmark", "bandingkan")
- `reviews` — minta verifikasi ("review", "cek ulang", "verifikasi")
- `volumes` — task besar ("project", "fitur baru", "refactor", "migrasi")
- `simple` — task satu-action ("baca X", "list", "jelaskan", "apa itu")

Aturan keputusan (berurutan, yang pertama cocok menang):
1. Task simpel + ada kata urutan → **single** (jebakan: "baca X terus ringkas")
2. `cross` + `sequences` → **squad, high, gak nanya**
3. `cross` sendirian → **squad, medium, TANYA dulu**
4. `research` sendirian → **squad, medium, WAJIB tanya** (kata "riset" ambigu)
5. `sequences` + `volumes` + panjang ≥160 → **squad, high**
6. `sequences` + `reviews` → **squad, medium, tanya**
7. ≥2 `sequences` + panjang ≥160 → **squad, medium, tanya**
8. Sisanya → **single**. Ini mayoritas kasus, dan itu SENGAJA.

**Prinsip: konservatif.** Salah-route ke squad itu mahal (N panggilan LLM);
salah-route ke single cuma bikin user ketik `/squad` manual. Karena itu
default-nya single, dan `shouldAsk: true` dipasang di semua kasus ragu.

**Kontrol:** `/route` (status) · `/route on` · `/route off` · `/route test <task>`
Env: `K_SROUTER_AUTOROUTE=1` buat nyalain dari start. **Default MATI** — opt-in.

**Wiring:** di `src/repl.js`, routing jalan SEBELUM dispatcher `/squad`, dan
kalau keputusannya squad, dia nyuntik prefix `/squad ` ke instruction — jadi
cuma ada SATU jalur eksekusi squad, gak ada logika kedobel.

### Test yang nge-drive runtime, bukan cuma baca file (2026-10-20)

`tests/test-autoroute-runtime.mjs` — spawn REPL beneran lewat child_process.

Alasan file ini ada: `test-autoroute-wiring.mjs` (20 pass) cuma regex **baca
teks** `repl.js`, dan itu LOLOS padahal ada bug runtime beneran —
`instruction` awalnya `const`, jadi saat auto-routing nyuntik prefix `/squad`
REPL langsung mati `Assignment to constant variable`. Regex gak bisa nangkep
itu. Pelajaran: **test yang cuma baca file itu bukan verifikasi.**

Test runtime juga terpaksa kasih jeda antar baris stdin — REPL pakai TUI yang
nge-overwrite baris, jadi input beruntun cuma baris pertama yang diproses.

## NEXT SESSION START POINT
**Baca ini dulu sebelum kerja apapun.**

M14 (Multi-agent PoC) + M15 (protokol JSON) + M16 (fan-out eksekusi) +
M17 (Telegram Squad + hardening) selesai. **M18 (UI upgrade + streaming +
npm global + MCP catalog) selesai 2026-10-20** — lihat seksi M18 di bawah.
Sekarang multi-agent UDAH JALAN BENERAN **di dua surface**: REPL `node index.js`
dan Telegram `node src/telegram-bot.js` — dua-duanya punya `/agent /plan /squad`
+ approval yang aturannya SATU (`src/approval.js`). `/squad <task>` ngedekomposisi
task lewat `plan()`, nge-dispatch ke beberapa agent (researcher/coder/reviewer)
sesuai `dependsOn`, nerusin hasil antar worker, nerakit ringkasan akhir — dan
worker yang crash gak matiin squad (error isolation M17).
Input biasa masih single-agent (default lama).

Cara test manual di REPL:
- `/plan riset cara kerja offline search lalu bikin kodenya` (preview saja)
- `/squad riset cara kerja offline search lalu bikin kodenya` (preview → `y` eksekusi, `r` replan, `n` batal)
- `/agent` (lihat role), `/help` (daftar command)

Cara test manual di Telegram (butuh `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USER_IDS` di .env):
- `node src/telegram-bot.js` → chat bot: `/help`, `/plan ...`, `/squad ...`
- Setelah `/squad` atau auto-route: `/approve`, `/cancel`, atau `/replan` (pending plan kedaluwarsa 30 menit)
- Approval aksi individual di dalam task: balas `y` / `s` / `n` / `c <kondisi>` (timeout 120s otomatis tolak)

Yang bisa dikerjakan berikutnya:

1. ~~**Auto-routing + review + research + verification + environments + focused research:**~~ ✅ SELESAI — M19–M41 mencakup review, verification, parallel wave, environment preflight, runtime adapters, research engine + structured evidence, circuit breaker, task budget, dan compact context. Baca seksi M19–M41.

2. ~~**Aksi destruktif lain:**~~ ✅ SELESAI (`M21`) — `delete`, `rename`, `move`
   ada di `src/file-ops.js`. Termasuk fix `/rollback` yang dulu gak bisa
   pulihin file yang dihapus. Lihat seksi M21.

3. **Paralel dalam wave (optimalisasi):**
   - Setelah `askApproval` dibikin concurrency-safe (mutex/queue), tukar inner
     loop `executePlan` ke `Promise.allSettled`. Struktur wave udah siap.
   - CATATAN M17: approval Telegram punya busy-gate + state terpusat, jadi lebih
     gampang dikonversi ke paralel daripada approval readline REPL.

3. **Tolak/validasi task besar:** (sudah ada batch potential, belum dikerjakan)
   - Task yang butuh > `MAX_PLAN_TASKS` (4) subtask — sekarang `plan()` balikin
     ok:false + feedback. Bisa ditambah auto-split jadi batch, atau guide user
     buat pecah manual.

4. ~~**Cleanup (dari M10):** hapus `lib/` folder~~ ✅ SUDAH BERSIH (2026-10-19
   dicek: `lib/` gak ada di working tree, `mcp/client.js` sudah jadi pengganti
   `lib/mcp.js`).

5. ~~**Test MCP sehat lagi (dari M17):**~~ ✅ SELESAI (2026-10-19) — lihat
   FINDING MCP yang sudah RESOLVED.

## M20 — Parity Telegram + Guard Output + Intent Heuristik (2026-10-20)

Audit "apa yang kurang dari agent ini" menghasilkan 4 item yang bisa
dikerjakan (handle-able). Semua selesai di commit ini.

### 1. `bash` — maxBuffer & output bocor (BUG, bukan sekadar kurang)

Default Node `maxBuffer` = 1MB. Command dengan output lebih besar
**GAGAL** dengan `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`:

- Pesan errornya cryptic → agent nyimpulin command-nya rusak, padahal cuma
  outputnya kegedean. Ini misdiagnosis, bukan error biasa.
- Jebakan KEDUA yang ketangkep waktu tes: jalur SUKSES gak ikut dipotong.
  `head -c 2000000 /dev/zero` lolos **utuh 2MB** ke LLM. Mahal + bikin
  konteks kotor.

Fix (`src/bash.js`):
- `MAX_BUFFER_BYTES = 8MB` — ceiling naik, jadi command wajar gak pernah kena.
- `MAX_OUTPUT_CHARS = 20000` — stdout & stderr **dua-duanya** dipotong di
  jalur sukses DAN error, dengan penanda `[...TRUNCATED n karakter...]`.
- Field `truncated: true` + `buffered: true` biar pemanggil bisa bedain
  "output kepotong" vs "command gagal".
- **Timeout dibaca PER-PANGGILAN** (`process.env.K_SROUTER_BASH_TIMEOUT_MS`
  dibaca di dalam `runCommand`, bukan di-`const` pas import). Sebelumnya env
  yang diubah setelah import gak ngefek — ketangkep tes timeout.
- Default timeout 120s (`K_SROUTER_BASH_TIMEOUT_MS` buat override).
- Kena maxBuffer → balikin `buffered:true` + pesan jelas, BUKAN throw mentah.

### 2. `read` — buta bagian file di atas 2000 karakter (BUG)

Dulu: file >2000 char dipotong `[...TRUNCATED]` dan **gak ada cara** baca
sisanya. Bug di baris 500 = invisible selamanya. Agent ngerjain file besar
dengan mata setengah ketutup.

Fix:
- `readFileRange(target, offset, limit)` di `src/utils/fs.js` — baca
  **jendela baris** (default 1..400, maks 2000 baris), output bernomor baris,
  plus footer yang ngasih tau sisa baris + `offset=` buat lanjut.
- `plan.js` parse `OFFSET:` / `LIMIT:` dari respons model. Nilai gak masuk
  akal (negatif/0) **DIBUANG**, bukan dipaksa jadi angka aneh — biar
  `readFileRange` pakai default-nya. Batas atas 2000 baris.
- Prompt `src/prompts/system.js` dikasih contoh `OFFSET`/`LIMIT`.
- `readFileSafe` TETAP ada (dipakai jalur lain) — `readFileRange` yang baru,
  bukan ganti total.

### 3. `intent.js` — hemat 1 LLM call per input

Dulu **SETIAP** input user (termasuk "halo kaccan") manggil LLM cuma buat
nentuin casual/task/hybrid. Itu satu panggilan penuh SEBELUM kerjaan mulai,
dan input teks doang jadi 2 call (classify + jawab).

Fix: `classifyIntentHeuristic()` — regex murni, **nol** panggilan LLM buat
kasus yang jelas. LLM cuma dipanggil kalau heuristiknya beneran ragu.
Signature `classifyIntent(input, askFn)` TIDAK berubah → caller aman.

Aturan yang dipakai (urutannya penting, ada tesnya):
- Hybrid (tanya + suruh) dicek **sebelum** task. Kalau task duluan,
  "tolong jelasin kenapa error lalu perbaiki" keburu dicap task.
- Realtime **wajib 2 syarat**: kata waktu + konteks cari info. Ini nutup bug
  nyata — kata `"tadi"` doang dulu bikin "aku tadi mimpi aneh" di-route ke
  agent otonom. "tadi" itu waktu lampau, bukan minta info terkini.
- Ragu → fallback **`casual`**, bukan `task`. Salah ke `task` = satu panggilan
  agent otonom penuh (mahal); salah ke `casual` = user cuma ngulang. Prinsip
  sama kayak routing: salah ke yang mahal itu boros.
- `confident:false` + `reason` dikembalikan biar caller bisa mutusin.

Hasil: dari 23 kalimat uji, **4** yang manggil LLM (dulu 23). 23/23 tebakan
tetap benar.

### 4. Telegram — parity sama REPL

Repo ini dua surface (REPL + Telegram). Telegram ketinggalan fitur baru —
`/route` **nol kayu** (grep balik 0). Dari HP user gak bisa kontrol apa pun.

Fix (`src/telegram-bot.js`):
- `/route` — status + `on` / `off`.
- `/route test <task>` — verdict routing **pakai `routeTask()` asli**, bukan
  logika tiruan.
- **Auto-routing ikut jalan di jalur pesan biasa**, bukan cuma command pasif.
  Task kompleks + `autoRoute` ON → langsung squad. Yang ragu → tanya dulu,
  jangan asal jalan.
- `describeRouting` bisa di-inject (buat tes).
- `/help` nyebut `/route` + `/route test` + `/mode`.

### Bug yang ketangkep lewat TES, bukan lewat baca kode

Semua ini kebukti cuma karena dijalanin beneran:

| Bug | Ketangkep oleh |
|---|---|
| `verdict.reasons` → field-nya `reason` (singular) | jalur squad Telegram **crash** |
| `describeRouting(verdict)` → nerima objek, bukan string | `/route test` error |
| `executePlan(p, ctx, deps)` → approval lewat `ctx.askApproval` | gue pake `onApproval` (salah) |
| stdout 2MB lolos utuh | tes bash jalur sukses |
| timeout env gak kebaca setelah import | tes `sleep 6` |
| `LIMIT: -5` → jadi `1` baris | tes parser planStep |

Pelajaran yang diulang dari sesi lalu: **tes yang cuma baca teks file bisa
PASS padahal runtime-nya crash.** `test-telegram-route.mjs` makanya ngejalanin
`handleMessage` yang sama kayak pesan Telegram asli masuk.

### Test

- `tests/test-intent.mjs` — 11 pass (tebakan + hitungan panggilan LLM).
- `tests/test-bash-read.mjs` — 42 pass (maxBuffer, truncate, timeout, range,
  parser planStep, guard `.env` masih hidup).
- `tests/test-telegram-route.mjs` — 34 pass (verdict asli, auto-route ON/OFF,
  ragu harus tanya, casual gak di-route).
- `run-suite.sh` diperbarui: rekap per-file + daftar file gagal.
- **Total suite: 388 pass, 0 fail, 21 file** (naik dari 307).


## FINDING Terbuka

**[RESOLVED 2026-10-19] `tests/test-mcp.mjs` exit=1 kalau server MCP mati:**
Dulu test itu LIVE-CHECK `discoverTools()` → 0 tool → `exit 1`, jadi suite
gagal tiap kali server lagi mati. Diperbaiki dua bagian:

1. `tests/test-mcp.mjs` (rewrite) — **health-check dulu**, lalu bedain:
   - 0 connection aktif (`~/.krouter_data/connections.json` gak ada / kosong) →
     `SKIP exit 0` + catat. **Environmental, bukan regresi.**
   - ada connection tapi 0 tool terdiscovery (server mati/tidak terjangkau) →
     `SKIP exit 0` + catat.
   - MCP hidup → **wajib lewat**: tool pool non-empty, tiap tool punya
     `_serverUrl`/`_serverName`, `summarize` ada + punya `inputSchema`,
     `callTool` balikin hasil non-kosong, tool tak dikenal melempar error
     "tidak ditemukan".
2. **Kontrak client akhirnya keuji beneran** lewat 2 file baru:
   - `tests/helpers/mock-mcp-server.mjs` — mock MCP Streamable HTTP
     (zero-dep, `node:http`): `initialize`/`tools/list`/`tools/call`,
     handshake `mcp-session-id` (request selain initialize dengan session
     asal = `400 Unknown session`), tool `summarize` + `echo`, dan mode
     **SSE** via `?sse=1` (Content-Type `text/event-stream`).
   - `tests/test-mcp-client.mjs` — **24 pass**: discovery JSON dan SSE,
     session handshake, cache tool ke registry + `lastConnected`,
     `callTool` (mode poin/kalimat, arg passthrough), error propagation
     (arg wajib hilang → error server ke-propagate), server mati →
     `discoverTools()` balikin `[]` tanpa nge-throw.
   - **Isolasi wajib:** test nge-set `HOME` ke tmp **sebelum** import
     `registry.js` (registry ngitung path saat load), jadi
     `~/.krouter_data/connections.json` user asli gak pernah ke-sentuh.

Hasil: suite penuh **163 pass, 0 fail, 14/14 file exit=0** (2026-10-19).

**[RESOLVED 2026-10-17] logStep crash kalau threadId=null (jalur mati):**
`logStep` di `db.js` kini DEFENSIF: shape legacy `{task, ...}` ternormalisasi
(`content ?? task`, `role ?? 'assistant'`), dan `threadId=null` → **skip dgn
return null** (thread_id NOT NULL + FK — tanpa thread gak ada tempat nyimpan),
bukan crash `ERR_INVALID_ARG_TYPE`. Dites di `tests/test-bugfixes.mjs` (15 pass).

**[RESOLVED 2026-10-17] Diff tidak akurat untuk file besar:**
`src/diff.js` **di-rewrite penuh**: prefix/suffix trim + **Myers O(ND)** (trace
backtrack ala Coglan, D-cap 500 + fallback block-replace utk sisa >3000 baris —
memory-safe di HP) + output **unified hunk** `@@ -a,b +c,d @@` context 3 baris
(gaya git; count=0 → start = baris sebelum). Insert/delete di tengah file besar
kini TIDAK bikin seluruh baris bergeser ke-flag. Test: `tests/test-diff.mjs` (12 pass).

**[RESOLVED 2026-10-17] Snapshot untuk file baru:**
**Akar masalahnya bukan cuma file baru — seluruh handler `edit` HILANG** sejak
commit `bff2c6a "fixed syntax error"` (30 Agt 2026) yang membuang 46 baris
(incl. `saveSnapshot`): sejak itu `ACTION: edit` diparse `plan.js` tapi TIDAK
PERNAH dieksekusi, dan snapshot gak pernah terisi untuk FILE MANA PUN (rollback
tanpa data total, bukan cuma file baru). Fix:
- Handler `edit` **dikembalikan** di `run-task.js` + diperkuat: guard
  `isSafePath` EKSPLISIT sebelum tulis (versi lama menulis walau baca ditolak =
  celah), mkdir parent, try/catch tulis, approval ditolak → catat `approved:false`.
- Schema `snapshots` + kolom **`is_new_file`** (CREATE baru + ALTER migrasi DB
  lama; baris lama DEFAULT 0 = benar utk semua snapshot historis). File baru →
  snapshot `content=''`, `is_new_file=1`.
- `/rollback` utk file baru = **konfirmasi HAPUS file** (balik ke kondisi
  "belum dibuat"), bukan tulis kosong. Lihat cabang `snap.is_new_file` di `repl.js`.
- Test: `tests/test-bugfixes.mjs` (15 pass: file baru/lama/blocked path/ditolak).

**[RESOLVED] lib/mcp.js masih aktif dipakai:**
Sudah diganti dengan mcp/client.js, import di index.js sudah update. `lib/mcp.js`
masih ada tapi tidak dipakai — akan dihapus setelah catalog selesai.

**[RESOLVED 2026-10-17] Diff tidak akurat untuk file besar — lihat detail di RESOLVED Diff (rewrite Myers) di atas.**

**[RESOLVED] Agent loop 10x untuk task mcp sederhana:**
Auto-done setelah single mcp_call kalau tidak ada continue-words di instruksi.

**[RESOLVED] Typosquatting pkg (APT/Termux):**
Sudah diimplementasi di lib/package-safety.js dengan Levenshtein distance.

**[RESOLVED] Agent bisa baca .env dan file sensitif:**
isSafePath() di lib/utils/fs.js sudah diperbaiki dengan path containment + blocklist.

**[RESOLVED] Provider config hardcode di providers.js:**
Sekarang dynamic dari settings.json via providers-registry.js dan /auth command.

## M45 — Ink Live Squad UI (2026-10-22)

UI squad sekarang event-driven dan punya renderer Ink opsional.

- `src/squad-ui.js` menyimpan state UI yang terpisah dari execution/safety core:
  task, wave, agent status, evidence, summary, dan error.
- `src/ink-squad-ui.js` merender panel live dengan React + Ink:
  status `pending/running/done/error`, wave aktif, evidence counter, dan error.
- `src/orchestrator.js` menerima optional `deps.onEvent` dan mengemisi:
  `wave_start`, `agent_start`, `agent_done`, `agent_error`.
- `src/repl.js` mengaktifkan Ink hanya kalau `K_SROUTER_UI=ink` dan stdout
  benar-benar TTY. Default tetap renderer lama/plain; Telegram tidak ikut
  bergantung pada Ink.
- Kalau Ink tidak aktif atau terminal bukan TTY, state/event tetap aman dan
  output fallback tidak spam: hanya agent selesai/error yang ditampilkan.
- `ink` dan `react` ditambahkan sebagai dependency UI; execution core,
  approval, verifier, budget, rollback, dan evidence gate tidak diubah otoritasnya.

Aktifkan:

```bash
K_SROUTER_UI=ink node index.js
```

Tes M45: squad UI state **6 pass**, UI mode **3 pass**, full suite
**668 pass, 0 fail, 41 file**.

## M44 — Self-Healing Harness & Strict Verification (2026-10-22)

M44 memperkuat prinsip: agent tidak boleh berhenti hanya karena mengklaim
selesai. Self-verification sekarang dipaksa di execution layer.

- `src/task-state.js`: checklist internal (`pending`/`completed`). `done` ditolak
  jika ada item pending.
- `lintAfterWrite()` di `src/file-ops.js`: file JS/MJS/CJS otomatis dicek dengan
  `node --check` setelah write/edit/append. Syntax error memicu rollback ke isi
  sebelumnya dan masuk sebagai `user_condition` yang memaksa koreksi.
- Bash dan delegate failure otomatis diubah menjadi `user_condition` eksplisit;
  agent wajib memperbaiki atau mencoba pendekatan lain sebelum `done`.
- Delegate result dinormalisasi menjadi artifacts, changed_files, tests, dan
  tests_passed. `verified` hanya true jika artifacts ada dan seluruh test punya
  exit code 0; summary saja tidak cukup.
- `run-task.js` menyimpan structured delegate evidence ke history.

Verifikasi M44:

- task-state: **7 pass**;
- structured delegate: **7 pass**;
- full suite: **659 pass, 0 fail, 39 file**.

## M43 — Delegated CLI Agents (Qwen / Claude / Antigravity) (2026-10-22)

KIANNNNN sekarang dapat mendelegasikan subtask terkontrol ke CLI agent yang
sudah terpasang di environment: `qwen`, `claude`, atau `agy` (Antigravity).

`src/delegate-cli.js` menyediakan:

- deteksi executable via `command -v`;
- command builder per CLI dengan `-p`, output JSON, sandbox, model/effort,
  `--add-dir`, dan opsi schema/mode yang didukung;
- parser output JSON/text ke `{ok, summary, data}`;
- timeout 120 detik, cwd eksplisit, max buffer 10 MB;
- error non-zero/timeout fail-closed;
- injected `spawnFn` untuk test tanpa menjalankan agent eksternal.

Action baru:

```text
REASONING: <alasan>
ACTION: delegate
AGENT: <qwen|claude|agy>
TASK: <task lengkap>
```

Runner tetap memegang approval KIANNNNN sebelum subprocess dijalankan. Agent
eksternal tidak dipercaya sebagai bukti final: hasil masuk history dengan
`verified: true` hanya sebagai bukti bahwa subprocess selesai menghasilkan
output; pekerjaan file tetap perlu dibuktikan lewat verifier KIANNNNN.
Agent yang tidak terdaftar ditolak, dan budget provider-call berlaku.

Test M43:

- `test-delegate-cli.mjs`: **21 pass**;
- `test-delegate-parser.mjs`: **5 pass**;
- full suite: **645 pass, 0 fail, 37 file**.

## M37–M41 — Research Engine, Structured Evidence, Circuit Breaker, Budget, Compaction (2026-10-21)

Masalah sebelumnya: rangkuman riset sepenuhnya bergantung pada satu panggilan LLM,
provider 429 bikin seluruh jalur mati, dan konteks web mentah memicu rate limit.

### M37 — Research Engine (`src/research-engine.js`)
- `rankSources()` — prioritas sumber resmi (BMKG/.gov/wttr.in/weather.com).
- `runResearchPlan()` — search → ranking → fetch → packet, deterministik,
  bisa jalan tanpa LLM (dependency di-inject untuk test).
- `packetFromHistory()` — history `web_fetch` sukses → packet (entry error di-skip).

### M38 — Structured Evidence
- `buildEvidencePacket()` — `{topic, fetchedAt, facts[], sources[], confidence}`.
- `extractFacts()` — normalisasi kunci (temperature/humidity/condition/wind_speed/
  pressure/visibility) dengan provenance per fakta (URL sumber).
- `renderPacket()` — teks ringkas siap-prompt berisi fakta + sumber.
- `buildEvidenceFallback()` — jawaban riset dari fakta terstruktur; kalau gak ada
  fakta, jatuh ke `buildResearchFallback` lama.

### M39 — Provider Health / Circuit Breaker (`src/provider-health.js`)
- `raceProviders` mengecek `providerHealth.isAvailable(key)` — provider yang
  kena 429/rate-limit di-cooldown 60 detik, TIDAK dipanggil ulang.
- Error match `429|rate limit|too many requests|retry-after` → `recordFailure`
  (dengan parsing `retry-after`); sukses → `recordSuccess` (tutup circuit).
- Snapshot state TIDAK pernah memuat API key.

### M40 — Task Budget (`src/task-budget.js`)
- Per task: `maxSteps`, `maxSearches` (default 2, `K_SROUTER_MAX_SEARCH`),
  `maxFetches` (default 3, `K_SROUTER_MAX_FETCH`), `maxProviderCalls`.
- `budget.consume('search'|'fetch')` di semua jalur web — termasuk safety net
  auto-fetch. Habis → paksa rangkum dari evidence, bukan loop nunggu error.
- Alias tunggal/jamak diterima (`step`/`steps`, dst), fail-closed.

### M41 — Compact Context (`src/research-context.js`)
- `compactResearchContext(packet, {maxChars})` — fakta + sumber dalam bentuk
  pendek untuk forcedInstruction, menggantikan evidence mentah 3000+ char.
- `focusWebText` JSON walk: wrapper `{value: "..."}` (weatherDesc) kini dirender
  dengan nama parent key → `weatherDesc: Smoky haze`, bukan `value: ...` polos.

### Perbaikan bug terkait
- Jalur forced-done sebelumnya bisa `return step.summary` = `undefined` (step
  masih `web_search`); kini selalu `forcedStep.summary` atau evidence fallback.
- Forced-summary fallback memakai `buildEvidenceFallback`, bukan
  `searchSummaries` mentah.

### Verifikasi M37–M41
- `tests/test-research-core.mjs`: **20 pass** (engine, packet, health, budget,
  compaction, glue).
- `tests/test-provider-health-wiring.mjs`: **5 pass** (cascade + circuit).
- `tests/test-web-focus.mjs`: **9 pass** (parent-key label).
- **Live test tanpa LLM**: fetch `wttr.in/Jakarta` nyata →
  `temperature: 38 C, humidity: 43 %, condition: Smoky haze, wind_speed: 22 km/h`,
  sumber tercantum.
- Suite: **619 pass, 0 fail, 35 file**.

## M36 — Tangan Riset Sendiri: Jawaban Gak Boleh Mati Gara-Gara LLM (2026-10-21)

Gejala: agent sudah `web_fetch` halaman yang berisi suhu, tetapi tetap menjawab
"data belum tersedia" — atau bahkan kosong total ketika provider kena `429`.

Akar masalah: seluruh rangkuman bergantung pada satu panggilan LLM. Kalau LLM
menolak menyimpulkan, atau provider limit, evidence yang sudah terkumpul tidak
pernah dipakai.

Perbaikan M36:

- `buildResearchFallback(instruction, history)` menyusun jawaban **langsung dari
  evidence** yang sudah dikumpulkan, tanpa LLM;
- dipakai otomatis ketika model gagal total balas format (termasuk saat provider
  `429` / semua fallback habis);
- evidence memakai hasil `focusWebText` (JSON weather diflatten) sehingga angka
  tetap terbaca;
- output selalu menyebut sumbernya.

Prinsipnya: **riset tidak boleh bergantung pada satu titik kegagalan.** Kalau
modelnya mati, tangan risetnya tetap bekerja.

Test `tests/test-research-fallback.mjs`: **5 pass**. Suite: **593 pass, 0 fail, 33 file**.

## M34 — Fokus Data Riset, Bukan Copy-Paste Halaman (2026-10-21)

M33 sudah membatasi preview terminal, tetapi halaman BMKG masih membawa
navigasi panjang ke history sehingga model dapat terdistraksi atau menjawab
bahwa data tidak tersedia. M34 menambah `focusWebText()`:

- membuang menu/navigasi/footer umum;
- mempertahankan kota, kondisi cuaca, suhu, kelembapan, dan istilah query;
- menyimpan teks fokus bounded untuk reasoning;
- preview terminal tetap pendek.

Test `tests/test-web-focus.mjs`: **8 pass**. JSON weather juga diflatten menjadi evidence (`temp_C`, `humidity`, `weatherDesc`) agar fallback summary tidak kosong. Suite: **588 pass, 0 fail, 32 file**.

## M33 — Tampilkan Preview Riset, Simpan Konteks Lengkap (2026-10-21)

Terminal hanya menampilkan preview pendek dari `web_fetch`, sementara isi halaman
masuk ke history untuk reasoning. Ini mencegah user dibanjiri copy-paste halaman.

## M32 — Optional Python / Go / TypeScript Toolchain Adapters (2026-10-21)

`src/toolchains.js` mendefinisikan adapter eksplisit untuk Python, Go,
TypeScript, dan JavaScript. Node tetap menjadi host/orchestrator; runtime lain
hanya dipanggil sebagai capability terkontrol dengan timeout dan approval.
Python dan Go diverifikasi tersedia di environment ini. TypeScript dicatat
sebagai optional karena `tsc` belum terpasang.

## M31 — Project Language Detection (2026-10-21)

`src/project-language.js` mendeteksi bahasa berdasarkan ekstensi file dan marker
project seperti `go.mod`, `package.json`, `tsconfig.json`, dan `pyproject.toml`.
Hasil diberi score deterministik dan tidak mengarang bahasa hanya dari prompt.

## M30 — Multi-Runtime Execution (2026-10-21)

Toolchain runtime punya `runToolchain()` dengan approval, cwd eksplisit,
timeout, exit code, stdout, dan stderr. Output dapat diteruskan ke verifier;
command runtime tidak melewati bypass approval.

## M29 — Agent Environment Contracts + Preflight (2026-10-21)

Setiap role sekarang punya contract environment: command wajib/opsional,
environment variable tanpa membocorkan nilainya, path read/write, capability,
dan kebutuhan network. `preflightEnvironment()` menghasilkan `ready`,
`degraded`, atau `blocked` sebelum `runTask` role dijalankan.

- `blocked` menghentikan task dengan alasan deterministik;
- `degraded` tetap boleh jalan dan hanya melaporkan requirement opsional;
- secret hanya dicek ada/tidak, nilainya tidak pernah dikembalikan.

## Verifikasi M29–M32

- contract/preflight/language/toolchain: **13 pass**;
- suite: **580 pass, 0 fail, 31 file**.

## M28 — Parallel Wave + Approval Queue (2026-10-21)

Task independen dalam satu wave sekarang dijalankan paralel dengan
`Promise.allSettled`. Wave berikutnya tetap menunggu wave sebelumnya, sehingga
`dependsOn` tetap deterministik dan hasil dependency tetap tersedia.

Approval interaktif tidak ikut balapan. `src/approval-queue.js` menserialkan
semua approval FIFO, menjaga prompt Telegram tidak tertukar saat dua worker
meminta izin bersamaan. Queue tetap pulih setelah handler approval melempar error.

Worker yang gagal tetap dikarantina per task; agregasi evidence M27 tetap menahan
`ok:true` final kalau ada worker gagal atau tidak punya bukti.

Tes M28:
- approval queue: **6 pass**;
- parallel wave + dependency: **4 pass**;
- suite: **567 pass, 0 fail, 30 file**.

## M27 — Final Squad Evidence Gate (2026-10-21)

Final squad result sekarang tidak otomatis dianggap sukses hanya karena semua
worker mengembalikan string. `src/squad-review.js` menolak ringkasan final kalau:

- hasil kosong;
- ringkasan final kosong;
- worker punya `verified:false`;
- worker tidak membawa `evidence`.

`executePlan()` menandai hasil worker dengan `verified`, `evidence`, dan `error`.
Worker yang crash tetap dikarantina agar task lain bisa lanjut, tetapi seluruh
squad dilaporkan `ok:false` sehingga tidak ada klaim sukses palsu.

## M26 — Web Fetch Hardening (2026-10-21)

`src/web-fetch.js` sekarang:

- resolve hostname dan menolak DNS yang mengarah ke loopback/private/link-local;
- mengikuti redirect secara manual;
- memvalidasi setiap target redirect;
- membatasi jumlah redirect;
- tidak mengirim cookie/credential;
- tetap mempertahankan timeout, size limit, dan content-type guard M23.

## M25 — File Actions: write / append / mkdir (2026-10-21)

`src/file-ops.js` menjadi satu gate untuk aksi file baru:

- `write` hanya membuat file baru dan menolak overwrite;
- `append` hanya menambah isi file yang sudah ada;
- `mkdir` membuat direktori baru;
- path sensitif tetap diblokir;
- parent directory boleh dibuat otomatis;
- hasil dibaca/dicek ulang sebelum masuk history sebagai `verified:true`.

Parser dan prompt mendukung tiga format baru. Coder mendapat whitelist ketiganya,
sementara researcher tetap read-only. Semua aksi baru punya preview dan approval
sebelum eksekusi.

### Verifikasi M25–M27

- file actions: **8 pass**;
- web hardening: **3 pass**;
- squad evidence review: **5 pass**;
- suite: **557 pass, 0 fail, 28 file**.

## M24 — Post-Action Verification: Agent Gak Boleh Asal Bilang Done (2026-10-21)

M24 menutup masalah paling penting setelah M23: agent bisa menjalankan aksi,
kemudian mengklaim `done` tanpa membuktikan hasil aktualnya.

### Aturan baru

`src/verifier.js` menjadi satu sumber aturan bukti:

- `edit`: baca ulang file dan cocokkan isi aktual dengan isi yang diminta;
- `bash`: wajib `ok:true` dan exit code `0`;
- `web_fetch`: isi halaman harus benar-benar terbaca;
- `web_search`: hasil sumber harus tersedia;
- `read`/`list_dir`: error eksplisit tidak boleh dianggap berhasil;
- `verifyCompletion`: summary kosong ditolak dan satu aksi dengan `verified:false`
  menutup gerbang `done`.

`run-task.js` sekarang:

- menandai hasil edit/bash/fetch dengan `verified`;
- mencatat bukti/verifikasi ke log;
- menampilkan `VERIFY_OK` atau error verifikasi;
- menolak `ACTION: done` jika masih ada aksi gagal atau summary kosong;
- mengirim instruksi koreksi ke model, bukan menerima klaim sukses mentah.

### Fail-closed

Verifier tidak mengarang hasil. Ia hanya menilai output aktual yang diberikan
runner. Kalau file hilang, exit code non-zero, fetch kosong, atau aksi gagal,
agent tidak boleh menutup task sebagai sukses.

### Verifikasi M24

- `tests/test-verifier.mjs`: **13 pass**.
- Suite: **541 pass, 0 fail, 25 file**.

## M23 — Web Fetch untuk Riset Berbasis Halaman (2026-10-20)

Riset sebelumnya hanya memakai snippet dari `Serper`/`Tavily`. Itu cukup untuk
konsep umum, tapi gagal untuk cuaca, harga, status layanan, dan data lain yang
snippet-nya tidak memuat angka/detail yang diminta. M23 menambah jalur membaca
isi halaman sumber.

### Action baru: `web_fetch`

`src/web-fetch.js` menyediakan fetch tanpa dependency tambahan:

- hanya URL `http`/`https`;
- blokir loopback/private address dasar;
- timeout default 12 detik;
- batas body default 600 KB;
- hanya konten teks/HTML/JSON/XML;
- hapus `script`, `style`, tag HTML, dan decode entity dasar;
- HTTP error, timeout, binary, dan body terlalu besar fail-closed;
- hasil dipotong aman untuk konteks LLM.

`src/plan.js` mem-parse format:

```text
REASONING: snippet belum cukup
ACTION: web_fetch
URL: https://contoh resmi.example/data
```

History merender isi halaman dengan strategi head + tail supaya navigasi panjang
di awal tidak menutupi data cuaca/harga di bagian bawah. Terminal hanya menampilkan
preview maksimal 800 karakter; isi lengkap tetap disimpan di history untuk reasoning,
agar user tidak dibanjiri copy-paste halaman mentah.

### Aturan riset yang fleksibel

Prompt tidak lagi memaksa `web_fetch` setiap kali. Agent boleh:

- langsung `done` kalau snippet sudah cukup;
- `web_fetch` kalau butuh detail halaman;
- search sekali lagi kalau sudut pandang query pertama kurang tepat;
- menjawab jujur kalau sumber memang belum cukup.

Sebagai safety net, setelah dua `web_search` tanpa fetch, runner mencoba sampai
tiga URL kandidat (mendahulukan BMKG/domain resmi) agar model tidak berhenti di
URL saja ketika membutuhkan data spesifik. Kandidat yang gagal dilewati.

### Verifikasi M23

- `tests/test-web-fetch.mjs`: **12 pass**, termasuk HTML cleanup, URL guard,
  size limit, HTTP error, binary, timeout, dan parser `web_fetch`.
- Live fetch BMKG: HTTP **200**, teks halaman berhasil dibaca.
- Suite: **528 pass, 0 fail, 24 file**.

## M22 — Review Rencana + Self-Correcting Execution (2026-10-20)

M22 menutup dua lubang besar setelah auto-routing dan aksi destruktif:

1. Rencana squad dulu langsung dieksekusi tanpa kesempatan user memeriksa
   pembagian role, brief, dependency, dan whitelist action.
2. Satu balasan model yang tidak punya format `ACTION:` membuat `planStep`
   throw sampai ke `runTask`; task mati walau langkah-langkah sebelumnya sudah
   selesai.

### Self-correcting `planStep`

`src/plan.js` sekarang punya `planStepWithRetry` (default maksimal 3 percobaan):

- `planStep` tetap mempertahankan kontrak lama; hanya error parsing yang diberi
  metadata `raw`.
- Balasan invalid dikirim kembali ke model bersama alasan kegagalan dan potongan
  balasan sebelumnya. Model diminta langsung memakai format `REASONING:` +
  `ACTION:` tanpa prose/markdown.
- Helper selalu resolve `{ ok, step, attempts }`; tiga kegagalan tidak melempar
  keluar loop. `run-task.js` mencatat kegagalan sebagai ringkasan terkontrol,
  mempertahankan history/progress sebelumnya.
- Jalur forced `done` setelah batas web search juga memakai retry; jika tetap
  gagal, task berhenti secara fail-closed sebagai `done`, bukan crash.

### Validasi makna rencana

`validatePlan()` sekarang memeriksa hal yang sintaks JSON tidak bisa tangkap:

- brief kosong/terlalu pendek;
- researcher/reviewer yang brief-nya dimulai kata kerja perubahan file;
- coder yang brief-nya meminta riset web;
- dependency yang berpotensi membaca hasil setelah perubahan.

Validator sengaja tidak memakai pencarian kata global: kata benda seperti
`"implementasi"` dalam brief riset yang berbunyi "fakta untuk implementasi"
tetap valid. Tes regresi untuk false-positive ini wajib ada.

`KNOWN_ACTIONS` diperbarui menjadi 11 aksi, termasuk `delete`, `rename`, dan
`move`.

### Gerbang review squad

Modul baru `src/plan-review.js` dipakai oleh REPL dan Telegram untuk menampilkan:

- jumlah task dan wave;
- role + brief lengkap;
- dependency;
- whitelist action tiap role.

REPL `/squad` sekarang: susun → preview → `y` eksekusi, `r` susun ulang,
`n` batal. Maksimal 3 kali replan. Telegram `/squad`, `/plan`, dan auto-route
menyimpan rencana pending per chat; `/approve` baru mengeksekusi, `/cancel`
membuang, `/replan` menyusun ulang maksimal 3 kali, dan pending plan kedaluwarsa
setelah 30 menit. Tidak ada eksekusi otomatis hanya karena route memutuskan
`squad`.

### Verifikasi M22

- `tests/test-plan-review.mjs`: **57 pass**.
- Runtime REPL nyata: preview tampil, `r` menghasilkan rencana baru, `y`
  menjalankan, `n` membatalkan tanpa eksekusi.
- Suite final: **516 pass, 0 fail, 23 file**.



Gate-nya udah lama ada di `src/modes.js` (`DESTRUCTIVE_ACTIONS`) tapi action-nya
belum pernah dibuat — jadi `/mode wellwell` punya aturan buat aksi yang gak bisa
dijalankan. Sekarang action-nya ada, dan gate-nya beneran kepakai.

### Kenapa dipisah ke `src/file-ops.js`

Handler destruktif gak boleh tersebar. Semua operasi lewat SATU pintu:
`inspectTarget` (lihat dulu) → `rejectReason` (boleh gak) → `applyFileOp`
(eksekusi). Kalau guard-nya ada di tiga tempat, cepat atau lambat ada yang
ketinggalan.

### Aturan yang dipegang

- **Lihat dulu, baru hapus.** `delete` nampilin isi file (baris bernomor) ke
  user sebelum minta approval. Hapus file tanpa nunjukin isinya = user
  approve sesuatu yang dia gak lihat.
- **Direktori gak kosong DITOLAK.** Bukan "dihapus rekursif". Kalau user
  memang mau rekursif, pakai `ACTION: bash` — biar approval command yang
  mutusin, bukan action ini diam-diam.
- **Gak ada file yang ditimpa.** `rename`/`move` ke `DEST` yang udah ada =
  gagal. Gak ada auto-overwrite, gak ada `-f`.
- **Snapshot WAJIB buat `delete`.** Gagal simpan snapshot = delete DIBATALKAN.
  `rename`/`move` gak butuh — file-nya masih ada, cuma pindah nama.
- **`rename`/`move` tanpa `DEST` → throw.** Parser fail-closed, bukan bikin
  langkah tanpa tujuan.

### BUG yang ketangkep: `/rollback` gak bisa pulihin file yang dihapus

`/rollback` yang lama cuma dirancang buat `edit`:

```js
const current = readFileSafe(filepath);   // file hilang -> "(file tidak ditemukan)"
...
fs.writeFileSync(filepath, snap.content); // nulis isi snapshot
```

Dua masalah nyata:

1. `is_new_file` cuma nangani file BARU → rollback = hapus file. Gak ada
   cabang buat file LAMA yang udah dihapus → harus DIPULIHIN.
2. `readFileSafe` di file yang hilang balikin string placeholder. REPL lama
   sempat nulis placeholder itu ke disk.

Fix (`src/repl.js`):

- File hilang + ada snapshot berisi → **PULIHIN**: bikin direktori induk kalau
  perlu, tulis ulang isinya, konfirmasi teksnya beda ("Pulihkan dari
  snapshot?").
- **Guard data-hilang:** snapshot KOSONG sementara file masih ada → rollback
  **DIBATALKAN**. Nulis `""` ke disk bukan rollback, itu menghapus isi file.

Jadi delete punya jalan pulang beneran, bukan cuma niat baik.

### Surface

- `src/file-ops.js` (baru, 176 baris)
- `src/plan.js` — parser `delete`/`rename`/`move` + `DEST` + label history
- `src/run-task.js` — handler + snapshot wajib + guard path
- `src/prompts/system.js` — format 3 action baru
- `src/repl.js` — fix `/rollback` (pulihin + guard snapshot kosong)

### Tes

`tests/test-file-ops.mjs` — **70 pass**. Nutup: gate per mode (wellwell tetap
nanya buat destructive), path diblokir, direktori gak kosong ditolak, DEST
ditimpa ditolak, DEST kosong ditolak, round-trip snapshot → hapus → pulihin,
dan guard snapshot kosong.

Suite total: **464 pass, 0 fail, 22 file**.