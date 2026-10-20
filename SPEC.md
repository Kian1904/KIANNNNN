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
- `/plan riset cara kerja offline search lalu bikin kodenya` (lihat rencana)
- `/squad riset cara kerja offline search lalu bikin kodenya` (eksekusi penuh)
- `/agent` (lihat role), `/help` (daftar command)

Cara test manual di Telegram (butuh `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USER_IDS` di .env):
- `node src/telegram-bot.js` → chat bot: `/help`, `/plan ...`, `/squad ...`
- Approval: balas `y` / `s` / `n` / `c <kondisi>` (timeout 120s otomatis tolak)

Yang bisa dikerjakan berikutnya:

1. **Auto-routing:**
   - Bikin `/squad` kepanggil OTOMATIS buat task kompleks (multi-intent), tanpa
     user harus ketik `/squad`. Pakai `classifyIntent` di `src/intent.js` atau
     heuristic: task panjang / ada "lalu"/"setelah"/"riset X lalu Y" -> squad.

2. **Paralel dalam wave (optimalisasi):**
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