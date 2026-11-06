# K' Architecture

## Purpose

K' is a local-first terminal agent. Its primary job is to turn a user instruction into a verified workspace change or an evidence-backed answer.

The project has one primary execution path. Everything else is optional until it is connected to that path and proven by an end-to-end task.

## Primary runtime path

```text
index.js
  -> repl.js
    -> run-casual.js       (conversation path)
    -> run-task.js         (task path)
      -> providers.js      (model request)
      -> plan.js           (action parsing)
      -> tool execution    (files, bash, web, MCP)
      -> approval policy
      -> verification
      -> session/journal persistence
```

## Core responsibilities

These modules are currently part of the primary runtime and must remain understandable:

- `src/repl.js` — terminal input and command dispatch
- `src/run-casual.js` — no-action conversational response
- `src/run-task.js` — task loop and task coordination
- `src/providers.js` — provider request and fallback behavior
- `src/plan.js` — model action protocol
- `src/file-ops.js` and `src/utils/fs.js` — workspace file operations
- `src/bash.js` — shell execution
- `src/approval.js` and `src/approval-queue.js` — permission decisions
- `src/verifier.js` — action/completion verification
- `src/db.js` and `src/task-journal.js` — persistence and recovery record
- `src/environment.js` — runtime preflight

## Optional boundaries

These capabilities are not allowed to define the core until a real end-to-end use case requires them:

- multi-agent planning and squad execution
- worker lifecycle simulation
- artifact/shared-artifact registries
- automatic routing
- research context/evidence helpers
- recovery and resume layers beyond the primary journal
- delegation to external CLIs
- MCP catalog and health management
- UI renderers beyond the basic REPL

They remain available for tests and experiments, but must not silently become required dependencies of a basic single-agent task.

## Rules for future changes

1. A new module needs a concrete caller in the primary runtime or it belongs under an optional/experimental boundary.
2. A passing unit test is not proof that a feature belongs in core.
3. Every task completion must be backed by observable evidence: file state, command result, or source/result record.
4. Keep one agent loop. Add modes/configuration before adding another execution engine.
5. Refactors must preserve the existing public CLI behavior unless a behavior change is explicitly documented.
6. Keep Termux and VPS on the same code path; the VPS is a build/test runner, not a second implementation.

## Current known debt

- `src/run-task.js` still owns too many side-effect concerns; execution-handler extraction remains the next major refactor.
- Several modules are test-covered but not connected to the runtime path.
- The test suite is environment-sensitive: Node must provide `node:sqlite` and network-dependent tests may skip or vary.
- `SPEC.md` contains historical milestone claims; runtime behavior and fresh test output take precedence.

## Locked decision — completion gate

The next core boundary is `src/core/completion-gate.js`. The `done` path is the authoritative definition of task success and must evaluate, in order: checklist state, completion summary, required project tests, evidence contract, and independent review. It returns a structured decision (`approved`, `reason`, `evidence`, `testResult`, `review`) and owns no UI or model-loop control. `run-task.js` remains responsible for feedback/retry and terminal journal writes. Do not add another completion/review engine while this boundary is being extracted.

Decision status: locked for implementation.

## Locked decision — execution boundaries

After completion-gate is stable, action side effects will move behind execution boundaries. The loop remains the coordinator; execution modules return structured results and do not own presentation. Optional capabilities (squad, delegation, research, routing, artifacts, recovery) stay outside the core path until an end-to-end use case proves otherwise.
