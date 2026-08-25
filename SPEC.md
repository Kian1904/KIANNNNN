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
  `/connect` (MCP plugin manager — IN PROGRESS, lihat M10).

- **MCP architecture — IN PROGRESS (M10):**
  Plugin system berbasis registry JSON, bukan hardcode URL. Struktur folder:
  ```
  mcp/
  ├── registry.js   ✅ DONE — load/save connections.json, CRUD operations
  ├── client.js     ⬜ TODO — connect ke server, discover tools, call tools
  └── catalog/
      ├── index.js  ⬜ TODO — known connectors catalog (K's Tools, dll)
      └── ktools.js ⬜ TODO — K's Tools connector (extracted dari lib/mcp.js)
  ```
  `mcp/registry.js` sudah selesai dan siap dipakai. Langkah berikutnya:
  buat `mcp/client.js` yang replace `lib/mcp.js`, lalu `mcp/catalog/`.

- **Package safety (M8):** `lib/package-safety.js`. npm registry check,
  threshold: 404 → block, published < 30 hari → warn, downloads < 1000/week
  → warn. Known-bad list: kv, cacheable. pkg: apt-cache search check.

- **Code style:** Pure ESM. JSDoc untuk type annotations (TS-ready — bisa
  migrate ke TypeScript kapanpun dengan rename .js → .ts + tsconfig, tanpa
  ubah logic). Tidak pakai TypeScript sekarang karena overhead di Termux.

## Keamanan
- API key/token TIDAK di-commit. Pakai `.env` via dotenv.
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

## Struktur Folder (current)
```
KIANNNNN/
├── mcp/                    ← MCP plugin system (BARU, in progress)
│   └── registry.js         ← ✅ DONE
|   └── client.js           < ✅️ DONE
├── lib/
│   ├── commands/
│   │   ├── model.js      ✅ handleModel()
│   │   └── usage.js      ✅ handleUsage(stats)
│   ├── prompts/
│   │   └── system.js     ✅ SYSTEM_PROMPT
│   ├── utils/
│   │   └── fs.js         ✅ readFileSafe, listDirSafe, loadAgentMd, isSafePath (security)
|
│   ├─ bash.js
│   ├── db.js
│   ├── diff.js
│   ├── distill.js
│   ├── intent.js
│   ├── mcp.js              ✅️ > sudah di-replace oleh mcp/client.js
│   ├── package-safety.js
│   ├── plan.js
│   ├── providers.js
│   └── ui.js
├── AGENT.md
├── index.js
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
- [ ] **M10 — MCP Plugin System (IN PROGRESS)**
  - [x] `mcp/registry.js` — JSON-based plugin registry, CRUD, JSDoc typed [DONE]
  - [x] `mcp/client.js` — multi-server client, replace lib/mcp.js [DONE] (multi-server, parallel discovery, callTools butuh toolPool param)
  - [ ] `mcp/catalog/index.js` — known connectors catalog
  - [ ] `mcp/catalog/ktools.js` — K's Tools connector
  - [ ] `/connect` command di index.js — dashboard plugin manager
  - [x] Update index.js imports: dari lib/mcp.js → mcp/client.js [DONE]
  - [ ] Delete lib/mcp.js setelah catalog selesai (actually udah delete lib/mcp, tapi untuk mcp catalog belum)
- [ ] **M11 — Web Search (ACTION: web_search)**
  - Cascade: Serper → Tavily
  - Hasil mentah tidak ditampilkan ke user
  - Agent reasoning dari hasil, output ke history
  - User lihat reasoning + sumber
  - File baru: `lib/search.js`
- [ ] **M12 — Extended MAX_LOOPS**
  - `const MAX_LOOPS = parseInt(process.env.MAX_LOOPS) || 25`
  - Set di `.env`: MAX_LOOPS=25

## Provider Cascade (current)

| Urutan | Key | Provider | Model default |
|--------|-----|----------|---------------|
| 1 | xkiro-coder | xKiro | qwen/qwen3-coder-plus |
| 2 | gemini | Google | gemini-3.1-flash-lite |
| 3 | xkiro | xKiro | deepseek/deepseek-v4-pro |
| 4 | openrouter | OpenRouter | nvidia/nemotron-3-ultra-550b-a55b:free |
| 5 | nvidia | Nvidia NIM | poolside/laguna-xs-2.1 |
| 6 | mistral | Mistral | mistral-small-latest |
| 7 | groq | Groq (last resort) | qwen/qwen3.6-27b |

## NEXT SESSION START POINT
**Baca ini dulu sebelum kerja apapun.**

Step berikutnya: lib/commands/rollback.js (extract dari index.js chat() loop),
lalu update SPEC struktur folder, lalu lanjut M10 catalog/ dan /connect.

1. Buat `mcp/catalog/ktools.js` — extracted K's Tools connector:
   ```js
   export default {
     name: "K's Tools",
     url: process.env.MCP_SERVER_URL,
     description: "Summarize dan tools belajar"
   }
   ```

2. Buat `mcp/catalog/index.js` — known connectors catalog:
   ```js
   import ktools from './ktools.js';
   export const CATALOG = [ktools, /* tambah lainnya nanti */];
   ```

2. Update `index.js`:
   - Ganti `import { discoverTools, callTool } from './lib/mcp.js'`
     menjadi `import { discoverTools, callTool } from './mcp/client.js'`
   - Tambah `/connect` command handler yang:
     - `/connect` → tampilkan active connectors + catalog
     - `/connect add <url>` → tambah custom connector
     - `/connect toggle <name>` → enable/disable

4. Setelah M10 done: lanjut M11 (web search) lalu M12 (MAX_LOOPS).

## FINDING Terbuka

**[OPEN] lib/mcp.js masih aktif dipakai:**
Belum di-replace oleh mcp/client.js. Jangan hapus sampai mcp/client.js selesai
dan ditest. Setelah selesai: hapus lib/mcp.js, update semua import.

**[OPEN] Diff tidak akurat untuk file besar:**
lib/diff.js pakai parallel line comparison, bukan Myers diff.

**[OPEN] Snapshot untuk file baru:**
File baru tidak punya snapshot — rollback tidak tersedia.

**[RESOLVED] Agent terlalu banyak loop untuk task sederhana (mcp_call):**
Agent sebelumnya loop hingga 10x setelah mcp_call karena LLM menganggap perlu "review" hasil.
Fix: tiga lapis — (1) perkuat SYSTEM_PROMPT di lib/plan.js dengan instruksi tegas: "JANGAN melakukan langkah lain setelah mcp_call kecuali user meminta. Anggap task selesai — pilih ACTION: done."; (2) tambah aturan di AGENT.md; (3) auto-done di index.js: setelah mcp_call, jika history hanya satu langkah dan instruksi tidak mengandung kata lanjutan (lanjut, terus, setelah, kemudian, lalu, selanjutnya), langsung return. Dengan ini, task mcp_call sederhana selesai dalam 1 loop.

**[RESOLVED] MCP result bloat context window:**
Hasil mcp_call panjang masuk history → kirim ulang ke LLM di langkah berikutnya.
Fix: truncate mcp_call result di buildHistoryText (lib/plan.js) ke max 500 karakter.
Tambahan: userPrompt di planStep sekarang punya reminder untuk langsung done setelah mcp_call.

**[RESOLVED] Typosquatting pkg (APT/Termux):**
Proteksi untuk pkg install cuma exist-check + known-bad list — jauh lebih lemah dari npm.
Fix: implementasi kombinasi di lib/package-safety.js: apt-cache search + popularitas (hardcoded list) + similarity (Levenshtein distance) dengan threshold <= 2. Auto-block hanya untuk known-bad; sisanya warning. Tested dengan gti (git typo) dan pytnon (python typo) menunjukkan warning.

**[RESOLVED] Agent bisa baca .env dan file sensitif:**
isSafePath() di lib/utils/fs.js -- BLOCKED_TARGETS list applied ke readFileSafe + listDirSafe.

**[RESOLVED] Agent loop 10x untuk task mcp sederhana:**
Auto-done setelah single mcp_call kalau tidak ada continue-words di instruksi.