# Execution Backends

StarNet's workbench tools run through a per-agent execution router. Tools ask the router to execute for an
agent; that agent's execution profile selects the host shell or isolated sandbox on the next command. The
legacy `STATION GEAR` profile follows the boot default for backward compatibility.

## Current Backends

### `local`

Default. Commands run on the host machine inside the agent's per-agent workspace:

```text
<WORKSPACES>/<agentId>/
```

This preserves the existing behavior: persistent cwd, `shell.exec`, `verify.run`, `shell.exec background:true`,
`shell.bg.status`, `shell.bg.read`, `shell.bg.write`, `shell.bg.kill`, checkpoints, and `fs.*` all keep working.

### `docker`

Selected by the per-agent `SAFE CELL` profile (or as the legacy boot default). Each agent gets one
deterministically named, ownership-labeled Docker container with its workspace
bind-mounted at `/workspace`. StarNet inspects and reuses that container across commands and sidecar restarts;
it creates, starts, and probes the container on first use when no owned environment exists:

```powershell
$env:STARNET_EXEC_BACKEND = "docker"
$env:STARNET_DOCKER_IMAGE = "node:20-bookworm"
node sidecar/index.js
```

Docker execution currently supports:

- `shell.exec`
- `verify.run`
- shared `fs.*` workspace persistence via the host bind mount
- host-side checkpoints for the bind-mounted workspace
- writable-layer persistence for installed packages and container caches
- container cwd persistence under `/workspace`, including sidecar restarts
- `shell.exec background:true` plus status, paged logs, stdin, EOF, and kill through the existing background manager
- capability drop, `no-new-privileges`, and a PID limit by default
- deterministic container names plus `ai.starnet.managed`, workspace, and agent ownership labels
- an explicit startup probe before any command is accepted
- local stdio MCP servers bound to a named Safe Cell agent: exact `docker exec` argv, no shell,
  connector env values kept off argv, and no fallback to an interactive host child

The container is deliberately not removed on ordinary sidecar shutdown: that is what preserves its writable
layer. Backend owners can call `cleanupAgent(agentId)` for explicit removal, or
`cleanupAgent(agentId, { remove:false })` to stop it without deleting state. Background process records remain
owned by the sidecar process; a restart reuses the container but does not claim that an old interactive stdin or
log ring can be resumed.

The owner-visible idle policy is stop-only. Its scheduler considers only a cell that this live sidecar has
successfully probed, rechecks the exact workspace/agent ownership labels, refuses foreground, background, and
stdio-MCP activity, and issues `docker stop`; it never issues `docker rm`. A same-name container with different
labels fails closed. Set the minutes in Settings > Permissions, use `0` to disable the scheduler, or use
`STOP IDLE CELL` for the same active-work refusal on demand.

### `ssh`

Selected by the per-agent `REMOTE SSH` profile. The owner supplies a host (or SSH config alias), optional user,
port, and absolute POSIX remote workspace in Settings > Permissions. Passwords and private keys are not accepted
or persisted: StarNet invokes the operating system's OpenSSH client with `BatchMode=yes` and
`StrictHostKeyChecking=yes`, so authentication stays in the OS SSH agent/config and an unknown host key fails.

SSH has no bind-mounted host workspace. StarNet therefore performs an explicit non-deleting overlay sync:

1. push the local `<WORKSPACES>/<agentId>` tree to the configured remote root;
2. run the command through remote `sh -s`, with the command and explicit service-key environment traveling on
   stdin rather than appearing in SSH argv;
3. pull the remote root back into the local agent workspace, even when the command exits non-zero.

The status reports readiness plus `never`, `syncing`, `ready`, or `error` sync truth and timestamps for the last
proven push/pull. A sync failure fails the tool call instead of claiming remote outputs returned. Sync never
deletes either side. Remote background/interactive PTY sessions and remote checkpoints are currently unsupported
and are reported as such; the checkpoint host consults the backend capability flag instead of snapshotting the
wrong local tree.

## Runtime Status

The sidecar exposes the station default and per-agent routing at:

```text
GET /api/execution
GET /api/execution-profiles
POST /api/execution/policy
POST /api/execution/ssh
POST /api/execution/sync
POST /api/execution/cleanup
```

The responses name the station default, each agent's routed backend, workspace mapping, background support,
persistence contract, and safe-cell controls. Docker availability is `unknown` before its first real probe,
`ready` after a successful probe, and `unavailable` with the bounded failure reason after a failed probe.
Profile changes are live for the next command and do not require a station restart.

## Local stdio MCP

The Connectors panel can run command-based MCP servers such as `npx …` only through `STDIO (Safe Cell)`.
The user chooses the owning agent; that agent must use the `SAFE CELL` profile, and Docker must pass its real
startup probe. The connector binding persists with its configuration and the public status names the owner.

The desktop sidecar still pins host stdio off. The isolated broker is the only production path that supplies
the transport's `userControlIsolated` proof. It starts the command as exact container argv, forwards only
explicit connector environment values plus host-owned safety pins, and never falls back to `shell:true` or a
host process when Docker is absent. A missing Docker runtime therefore produces an honest saved-but-not-connected
status instead of silently weakening the execution boundary.

Agent-authored skills remain a separate built-in lifecycle: `skill.write` and `skill.manage` can create, edit,
patch, archive, restore, pin, and attach package files, with the skill guard re-checking content before use.

## Project scopes

The Projects rail can run a bounded, user-triggered marker scan over conventional project shelves (or
`STARNET_PROJECT_DISCOVERY_ROOTS`). Discovery reads directory/marker names only, follows no symlinks, stops at
hard depth/count limits, and changes no grants. Selecting a candidate only fills the Add form. The separate
`ADD` action still canonicalizes the root and records the durable `path:<root>` owner grant; revocation remains
available through the Permissions/Projects surfaces.

## Execution Profiles

- `SAFE CELL` routes terminal/build work to that agent's persistent Docker container.
- `REMOTE SSH` routes terminal/build work to an owner-configured SSH host and synchronizes the agent workspace.
  Same-agent SSH commands and manual sync requests are serialized so their push/run/pull overlays cannot race.
- `TRUSTED PROJECT` routes locally with terminal, files, connected services, and approved project roots.
- `THIS COMPUTER` routes locally with non-protected host paths in scope. Protected files and physical desktop
  input remain separate hard floors.

Approval prompts are an independent posture: `ASK` or `RUN WITHOUT PROMPTS`. Changing that posture never
changes runtime, tools, filesystem scope, or desktop authority.

## Interactive Terminal Sessions

The Workbench also exposes `terminal.start/status/read/write/resize/interrupt/stop`. These use a real POSIX PTY
or Windows ConPTY, keep bounded scrollback, and persist lifecycle metadata. An active record from a prior
sidecar life is reported `unknown` and unattached; StarNet never claims it reattached from a stored PID.

Background subagents are managed above this environment seam. They can start on the local safe cell today, and
their durable records are exposed through:

```text
GET  /api/subagents
GET  /api/subagents?id=<subagentId>
POST /api/subagents/interrupt
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `STARNET_EXEC_BACKEND` | `local` | `local`, `docker`, or `ssh` |
| `STARNET_DOCKER_BIN` | `docker` | Docker-compatible executable |
| `STARNET_DOCKER_IMAGE` | `node:20-bookworm` | Image used for sandboxed commands |
| `STARNET_DOCKER_WORKSPACE` | `/workspace` | Container mount point |
| `STARNET_DOCKER_NETWORK` | empty | Optional Docker network value, for example `none` |
| `STARNET_DOCKER_CPUS` | empty | Optional Docker `--cpus` value |
| `STARNET_DOCKER_MEMORY` | empty | Optional Docker `--memory` value |
| `STARNET_DOCKER_SECURITY` | `true` | Adds `--cap-drop ALL`, `no-new-privileges`, and `--pids-limit 256` |
| `STARNET_DOCKER_EXTRA_ARGS` | `[]` | JSON string array of extra Docker args |
| `STARNET_DOCKER_IDLE_MINUTES` | `60` | Initial stop-only idle policy; the owner can persist a later value in Settings |
| `STARNET_SSH_BIN` | `ssh` | OpenSSH-compatible client executable |
| `STARNET_SCP_BIN` | `scp` | OpenSSH-compatible copy executable used for non-deleting workspace overlays |
| `STARNET_SSH_CONNECT_TIMEOUT_SECONDS` | `10` | Bounded SSH connection/probe timeout |

Legacy `SKYNET_EXEC_BACKEND`, `SKYNET_DOCKER_BIN`, and `SKYNET_DOCKER_IMAGE` are also accepted where applicable.

## Parity Direction

the reference harness's production shape includes a richer environment manager with SSH, Modal, Singularity,
Daytona, idle cleanup, and file synchronization for non-bind-mounted backends. StarNet now has the shared
environment seam, durable Docker reuse/background execution, stop-only idle cleanup, SSH routing, explicit
push/pull synchronization, and checkpoint capability flags. Future adapters can implement the same contract;
remote background-session resumption and delta/conflict-aware sync remain intentionally unclaimed.
