# Safe Cell Audit

Date: 2026-06-26

Scope: Phase 0.0 through the local safe-cell gate for background fan-out. This audit covers the StarNet execution surfaces that can touch the host filesystem or run code:

- `fs.read`, `fs.write`, `fs.append`, `fs.edit`, `fs.list`, `fs.search`
- `shell.exec`, `shell.exec background:true`, `shell.bg.status`, `shell.bg.read`, `shell.bg.kill`
- `shell.bg.write` — stdin to a process the agent started. Consent-gated and screened by the same
  `commandSafetyRisk` guard as `shell.exec`, because a line sent to a shell or REPL executes like a command;
  leaving it unscreened would have made `background:true` a route around that screen.
- `verify.run`
- checkpoint snapshot/restore
- global halt
- `team.dispatch` worker fan-out

## Verdict

Local execution passes the beginner-safe fan-out bar after the realpath jail hardening in this branch.

It is not a hostile-code sandbox. Arbitrary shell execution on the host remains a trusted-operator capability. For untrusted code, unknown repositories, or adversarial prompts, use the Docker backend.

The sequence decision is therefore:

```text
Phase 1.1 background subagents can run on local by default for consent-gated beginner workflows.
Docker remains opt-in and should become mandatory only for hostile-code or high-risk execution profiles.
```

## Controls Verified

Filesystem:

- Agent ids are grammar-restricted.
- Absolute paths, drive paths, UNC paths, null bytes, and `..` path segments are rejected.
- Each agent resolves under a distinct workspace root.
- Existing symlink or junction-like ancestors are realpath-checked before I/O.
- Hidden directories, `node_modules`, large files, and binary files are bounded/skipped in search.
- Secret redaction applies to surfaced search lines.

Shell and verification:

- `shell.exec` is capability-gated behind the workbench object.
- `shell.exec` and `verify.run` are consent-gated execute-scope tools.
- Autonomous runs cannot self-approve execute tools through cached grants.
- Shell cwd is pinned to the per-agent workspace and clamped after `cd`.
- Obvious escape commands using parent paths, drive-absolute paths, UNC paths, and protected control-file names are refused.
- Foreground commands have timeout and abort kill paths.
- Background shell processes are tracked, capped, status-readable, killable, and reaped by E-STOP.
- Shell/verify calls always trigger an auto-checkpoint before execution.

Rollback and halt:

- Checkpoints live outside the agent workspace.
- Restore only accepts snapshot ids recorded for that agent.
- E-STOP aborts foreground runs, channel runs, backend-owned background processes, and background subagents.

Background subagents:

- Background workers have durable records.
- Records include status, prompt, result, cost, run id, attempt count, and event tail.
- Workers can be interrupted by id.
- Running records become `stale` on sidecar restart and can be resumed through `team.resume`.

## Exploit Attempts Covered

| Attempt | Result |
| --- | --- |
| `../secret` via `fs.*` | Rejected |
| absolute Unix/Windows/UNC paths via `fs.*` | Rejected |
| sibling-agent workspace traversal | Rejected |
| bad `agentId` traversal | Rejected |
| symlink inside workspace pointing outside | Rejected by realpath ancestor check |
| shell parent path command | Rejected |
| shell drive-absolute command | Rejected |
| shell protected control-file command | Rejected |
| runaway foreground shell | Timeout/abort kill path |
| runaway background shell | `shell.bg.kill` or E-STOP |
| background worker outlives parent tool call | Durable record and status surface |
| background worker after restart | Marked stale and resumable |

## Residual Risk

Local `shell.exec` is not a hard sandbox. A user-approved shell command can still run host programs with the user's OS privileges. The safe-cell promise is:

```text
beginner-safe, visible, reversible, killable, and per-agent scoped
```

It is not:

```text
safe for hostile code
```

Docker is the first hostile-code boundary and should be used for high-risk work.

## Regression Gates

The audit findings are covered by:

- `node test/fs.jail.test.js`
- `node test/shell-session.test.js`
- `node test/shell-bg.test.js`
- `node test/shell.test.js`
- `node test/verify.run.test.js`
- `node test/environment.test.js`
- `node test/subagents.test.js`
- `node test/orchestration.test.js`
- `npm.cmd run test:fast`
