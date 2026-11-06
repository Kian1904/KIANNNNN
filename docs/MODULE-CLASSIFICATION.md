# Module classification

This is an evidence-based snapshot from runtime imports and tests. A passing test alone does not make a module core.

## CORE

- `src/run-task.js` — primary single-agent loop
- `src/providers.js`, `src/plan.js` — model and action protocol
- `src/file-ops.js`, `src/utils/fs.js`, `src/bash.js` — workspace and shell tools
- `src/verifier.js`, `src/core/completion-gate.js` — verification and completion decision
- `src/db.js`, `src/task-journal.js` — persistence
- `src/approval.js`, `src/approval-queue.js` — permission handling
- `src/core/*` — pure boundaries used by the core loop

## OPTIONAL

- `src/optional/delegation.js` → `src/delegate-cli.js`
- `src/optional/recovery.js` → `src/recovery.js`
- `src/optional/research.js` → research engine/context
- `src/optional/routing.js` → `src/routing.js`
- `src/orchestrator.js`, squad UI, MCP catalog, Telegram adapter

These are connected through optional adapters but are not part of the minimal architecture contract.

## TEST-COVERED OPTIONAL / EXPERIMENTAL

- squad, worker lifecycle, artifacts/shared artifacts, routing, research, delegation, recovery, budget and observability helpers

Their tests prove local contracts, not that each feature must remain in the product core.

## DEAD CANDIDATES — NOT DELETED YET

These require one more import/history review before deletion:

- `src/artifact-registry.js`
- `src/shared-artifacts.js`
- `src/worker-lifecycle.js`
- `src/model-router.js`
- `src/tracer.js`
- `src/mcp-health.js`
- `src/install-check.js`
- `src/task-progress.js`
- `src/task-resume.js`

Deletion is deferred until their test-only status and public command expectations are explicitly settled.
