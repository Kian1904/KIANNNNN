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
│   ├── repl.js              ✅ REPL loop & command router
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
  - `const MAX_LOOPS = parseInt(process.env.MAX_LOOPS) || 25` di `src/run-task.js`
  - Set di `.env`: MAX_LOOPS=25

## Provider Cascade (default seed, di settings.json)

| Urutan | Key | Provider | Model default |
|--------|-----|----------|---------------|
| 1 | xkiro-coder | xKiro | qwen/qwen3-coder-plus:free |
| 2 | gemini | Google | gemini-3.1-flash-lite |
| 3 | xkiro | xKiro | deepseek/deepseek-v4-pro |
| 4 | openrouter | OpenRouter | nvidia/nemotron-3-ultra-550b-a55b:free |
| 5 | nvidia | Nvidia NIM | poolside/laguna-xs-2.1 |
| 6 | mistral | Mistral | mistral-small-latest |
| 7 | groq | Groq (last resort) | qwen/qwen3.8-27b |

## NEXT SESSION START POINT
**Baca ini dulu sebelum kerja apapun.**

Restrukturisasi selesai (lib/ → src/, index.js dipecah, provider registry + /auth,
M12). Sekarang lanjut ke:

1. **M10 — MCP Plugin System:**
   - Buat `mcp/catalog/ktools.js` — extracted K's Tools connector
   - Buat `mcp/catalog/index.js` — known connectors catalog
   - Implementasikan `/connect` command di `src/commands/connect.js` (atau di repl.js)
   - Test dan hapus `lib/mcp.js` setelah catalog selesai

2. **M11 — Web Search:**
   - Integrasikan `src/search.js` ke dalam `run-task.js` (ACTION: web_search sudah ada)
   - Pastikan cascade Serper→Tavily berfungsi
   - Hasil mentah tidak ditampilkan ke user (cuma sources), agent reasoning dari hasil

3. **Cleanup:**
   - Hapus folder `lib/` setelah dipastikan semua import mengarah ke `src/`
   - Update semua referensi di `bin/kian` dan tests

4. **TUI (optional, prioritas lebih rendah):**
   - Kalau sempat, buat TUI berbasis `blessed` atau `ink` untuk UX lebih baik.

## FINDING Terbuka

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