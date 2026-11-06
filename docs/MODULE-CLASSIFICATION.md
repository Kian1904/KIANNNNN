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

## TEST-ONLY / EXPERIMENTAL CANDIDATES

These currently have tests or historical milestone references but no direct runtime import found in the inspected `src/` import graph:

- `src/artifact-registry.js`
- `src/shared-artifacts.js`
- `src/worker-lifecycle.js`
- `src/model-router.js`
- `src/tracer.js`
- `src/mcp-health.js`
- `src/install-check.js`
- `src/task-progress.js`
- `src/task-resume.js`
- `src/budget-engine.js`

They are intentionally not deleted in this pass because tests, commands, or external consumers may still import them. Deletion requires an explicit compatibility decision.
