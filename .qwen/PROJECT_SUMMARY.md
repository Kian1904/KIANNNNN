# Project Summary

## Overall Goal
Build KIANNNNN (K-sRouter-CLI), an agentic AI CLI with multi-provider LLM cascade, MCP plugin system, memory layers, and an interactive TUI, targeting pure ESM Node.js on Android/Termux with no native dependencies.

## Key Knowledge
- **Tech stack**: Node.js (ESM), SQLite (`node:sqlite`), native `fetch`, no native modules (Termux/ARM compatibility). JSDoc-typed code, ready for TypeScript migration.
- **Provider registry**: Stored at `~/.config/k-srouter/settings.json` with atomic writes and chmod 600. Managed via `/auth` CLI command (add/remove/use/key). API keys stored plaintext per user preference.
- **Security**: `isSafePath()` rewritten with absolute path resolution, cwd containment, realpath verification, segment blocklist. MCP `discoverTools()` no longer leaks `_apiKey` to LLM context.
- **Architecture**: `src/` is source of truth, `lib/` kept for backward compatibility but all imports now point to `src/`. `index.js` is minimal bootstrapper; core logic split into `repl.js`, `run-task.js`, `run-casual.js`, `providers.js`, etc.
- **MCP integration**: Plugin registry (`mcp/registry.js`) and client (`mcp/client.js`) support multiple connectors. Catalog (`mcp/catalog/`) defines known connectors, and `/connect` command manages them.
- **Web search**: Cascading search (Serper → Tavily) with timeout and fallback. Integrated via `ACTION: web_search` in ReAct loop.
- **MAX_LOOPS**: Read from `process.env.MAX_LOOPS` (default 25).
- **User preferences**: Bahasa Indonesia, casual direct style (“gue”/“lo”), free-tier providers preferred. User is a data scientist focused on observability/logging.

## Recent Actions
- **Security fixes**: Patched path traversal in `fs.js` and removed API key leak from MCP client.
- **Restructuring**: Moved `lib/` → `src/` with modular split; `index.js` now ~19 lines.
- **Provider registry**: Implemented `/auth` command with CRUD on `settings.json`; dynamic provider loading in `providers.js`.
- **M12**: Added `MAX_LOOPS` env var support.
- **Web search (M11)**: Integrated `searchWeb()` with Serper/Tavily cascade into `run-task.js` and `plan.js`.
- **MCP catalog & /connect (M10)**: Implemented `mcp/catalog/ktools.js`, `mcp/catalog/index.js`, and `src/commands/connect.js`.
- **TUI**: Built `src/tui.js` with Agent CLI-style chat boxes, typing animations, loading spinners, and integrated into `repl.js`. Resolved export issues and module compatibility.
- **Testing**: Smoke tests (`smoke-plan.mjs`, `test-web-search.mjs`, `tui-test.mjs`) pass. REPL starts and handles `/exit` without error.

## Current Plan
1. [DONE] Security hardening (path traversal, MCP leak)
2. [DONE] Codebase restructuring (`lib/` → `src/`)
3. [DONE] Provider registry + `/auth` command
4. [DONE] M10: MCP catalog + `/connect` command
5. [DONE] M11: Web search cascade (Serper → Tavily)
6. [DONE] M12: MAX_LOOPS from env
7. [DONE] TUI foundation (chat boxes, animations, integration)
8. [TODO] Clean up `lib/` folder (remove backward compatibility copies) after verifying all imports use `src/`
9. [TODO] Enhance TUI: global keyword activation (“KIANNNNN” anywhere), persistent chat history display, real-time streaming of LLM responses
10. [TODO] Possibly integrate `web_search` with TUI for inline results
11. [TODO] Finalize TUI design per user’s “Agent CLI” vision (better box styling, color scheme, responsive layout)

Next session: likely TUI refinements and cleanup of `lib/`. All core agentic functionality (ReAct loop, LLM cascade, MCP, search, memory, approval gates) is complete and verified.

---

## Summary Metadata
**Update time**: 2026-08-29T14:50:25.332Z
