# Module classification

Evidence snapshot: runtime imports were inspected with `search_files`; focused runtime and boundary tests were rerun after each boundary change. Test coverage alone does not make a module core.

## CORE

- `src/run-task.js` — primary single-agent coordinator
- `src/providers.js`, `src/plan.js` — model and action protocol
- `src/file-ops.js`, `src/utils/fs.js`, `src/bash.js` — workspace/shell primitives
- `src/verifier.js`, `src/core/completion-gate.js` — verification/completion
- `src/db.js`, `src/task-journal.js` — persistence
- `src/approval.js`, `src/approval-queue.js` — permission handling
- `src/core/*` — pure/execution boundaries now called by the coordinator

## OPTIONAL

- `src/optional/delegation.js` → `src/delegate-cli.js`
- `src/optional/recovery.js` → `src/recovery.js`
- `src/optional/research.js` → research engine/context
- `src/optional/routing.js` → `src/routing.js`
- `src/orchestrator.js`, squad UI, MCP catalog, Telegram adapter

Optional adapters are reachable by user-facing flows but are not part of the minimal single-agent contract.

## EXPERIMENTAL / TEST-ONLY

The following modules are now physically isolated under `src/experimental/`. They retain their APIs and tests but are not imported by the minimal core runtime:

- `artifact-registry.js`
- `shared-artifacts.js`
- `worker-lifecycle.js`
- `model-router.js`
- `tracer.js`
- `mcp-health.js`
- `install-check.js`
- `task-progress.js`
- `task-resume.js`
- `budget-engine.js`

Isolation is not deletion. Re-enable or delete them only after an explicit compatibility decision.
