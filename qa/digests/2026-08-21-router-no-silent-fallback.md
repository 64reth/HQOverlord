# Lane C — a requested sandbox is honored or refused, never faked (2026-08-21)

Branch `agent/router-no-silent-fallback`, forked from trunk `bc797dc72`. NOT merged.

## What was wrong

`sidecar/execution-router.js` routed SAFE CELL to docker *if the docker manager was registered, else the
default (local) backend* — and its header claimed the opposite. `execution-profiles.js` computed
`backendMatched` for the UI but nothing enforced it. `terminal-sessions.js` spawned node-pty on the host
regardless of the agent's backend. Checkpoints (`CHECKPOINTS_ENABLED`) defaulted OFF, so the rollback net
nobody switched on caught nothing.

In the real sidecar all three managers (local/docker/ssh) are registered unconditionally, so the
"registered" check was always true and Docker's absence surfaced as a raw `spawn docker ENOENT` the model
then tried to route around — by opening a host terminal.

## What changed

- **C1 `resolveBackend(profileId, agentId)` → `{ id, requested, matched, reason, profileId, availability }`**;
  `resolutionFor(agentId)`; `backendIdFor` unchanged for callers. "Present" now means the manager's own
  `describe().availability` is not `absent | unavailable | configuration-required`. `describeAgent` carries
  `requestedBackend`, `backendMatched`, `mismatchReason`, `sandboxFallback`, `refusing`. Header rewritten.
- **C2 `STARNET_SANDBOX_FALLBACK = refuse (default) | allow`.** Under refuse, `forAgent()` returns:
  - a *refusing proxy* when the sandbox is absent (execute-class methods reject `{code:'sandbox_unavailable',
    requested, reason, precondition}`; describe/status/workspace methods still answer), or
  - an *honest proxy* over a registered docker/ssh manager: the manager attempts for real (that IS the probe);
    if it fails while its availability says unusable, the raw error is re-typed to `sandbox_unavailable`
    (cause attached). Docker started later is honored on the next call — no restart.
  `refusalFor(agentId)` lets tools refuse BEFORE checkpointing/cwd work. A probed-unavailable docker keeps
  id `docker` (never `local`) so the stdio-MCP / isolation gates in index.js stay truthful.
  Under `allow` the old silent-local behaviour remains but `backendMatched:false` is still reported.
- **C2 tools** `shell.exec` (fg + background), `verify.run`: up-front `sandboxRefusal()`; the registry's
  existing `e.precondition` path frames it as `<tool_precondition>`. Copy: *"This agent's profile is SAFE CELL
  but Docker is not available on this machine. Start Docker, or change the agent's execution profile. The
  command was NOT run on this computer."*
- **C3 `terminal.start`**: refuses the sandbox mismatch the same way, and refuses ANY non-local effective
  backend with precondition `terminal_requires_local_backend`: *"interactive terminals run on the host; this
  agent is sandboxed (profile safe-cell → docker)…"*.
- **C4 UI**: `sandboxChip(row)` in stationui.js renders a red `▲ SANDBOX UNAVAILABLE` chip + fix line from
  `environment.backendMatched === false` on both the dossier truth line and the Settings crew row. Theme-var
  paint (`--bad`), no native control. `sync:website` mirrored; claims re-locked (`94f50c439`).
- **C5 checkpoints default ON**: `checkpointsEnabledFromEnv` — empty → on; `0|false|no|off` → off. Fail-open
  untouched. Boot cost: the flag only gates snapshot calls at tool time; the seeded workspace booted normally.

## Tests (new/extended; registered in test/fast.list)

- `test/execution-router.test.js` 21 → 56 assertions (mismatch resolution, refusing proxy, sync stdio refusal,
  describeAgent fields, allow policy, probed-unavailable → typed error → recovery).
- `test/sandbox-no-silent-fallback.test.js` (new, 20): shell.exec/verify.run dispatched through the real
  registry return `summary:'precondition'` with the frame and a spawn spy at 0; terminal.start refusals.
- `test/execution-profiles-ui.test.js` +10: chip helper evaluated for real.
- `test/checkpoint-default-on.test.js` (new, 14): the shipped env parser + fs.write's precise path.
- `test/sidecar.http.test.js`: `GET /api/checkpoint` → `enabled:true` with no env var.

## Live proof (seed on :9971, Docker absent on this box, `STARNET_FULL_ACCESS=0` so Full Power did not force local)

- `GET /api/checkpoint?agent=agent` → `enabled:true` (no env var).
- SAFE CELL set via `App.setExecutionProfile` (the dossier chip's path); survived a sidecar restart.
- COMMS "run `echo hi`" → real consent card → approved → transcript tool result carries
  `sandbox_unavailable` + "Docker is not available on this machine (environment process error: spawn docker
  ENOENT). Start Docker, or change the agent's execution profile. The command was NOT run on this computer."
- The model then tried `terminal.start {command:"bash"}` (the exact escape) → refused with
  `terminal_requires_local_backend`; `proc-ledger.json` = `{"procs":[]}` — nothing spawned on the host.
- `/api/execution-profiles` after the probe: `backendMatched:false, refusing:true, availability:unavailable`.
- Dossier DOM: `.sandbox-chip` present, text `▲ SANDBOX UNAVAILABLE`, color `rgb(255,92,77)` (= `--bad`),
  fix line names "Start Docker, or change the execution profile."

## Owed / notes

- Full Power (`FULL_ACCESS`, master bypass, approvalMode full) still forces local by the existing law; the UI
  already labels that override. Not changed.
- The SSH `configuration-required` state is treated as unusable → REMOTE SSH with no saved target now refuses
  instead of running locally.
