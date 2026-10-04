# StarNet ref-Replacement Phase 3

Phase 3 is the beta replacement proof. Phase 2 made the core signals trustworthy;
Phase 3 turns the remaining the reference harness gap list into a loop that can run until StarNet
is good enough to replace the reference harnessAgent as the user's main harness.

The rule is simple: every claim must come from evidence under `.dogfood/`. If a
provider key, Cargo, a live browser, or a desktop driver is missing, the runner
marks the item `blocked`. If a feature is not implemented, the runner marks it as
an implementation gap. No placeholder gets blessed as parity.

## Steering Commands

Run the full Phase 3 classifier:

```powershell
npm.cmd run phase3
```

Run the continuous loop form after each fix:

```powershell
npm.cmd run phase3:loop
```

Run only the daily-driver dogfood pack:

```powershell
npm.cmd run dogfood
npm.cmd run dogfood:live
```

Evidence lands in:

- `.dogfood/phase3-<timestamp>/summary.md`
- `.dogfood/phase3-<timestamp>/phase3-status.json`
- `.dogfood/phase3-latest/`
- `.dogfood/dogfood-latest/`

## Phase 3 Goal

StarNet reaches beta replacement standing when:

- Phase 2 foundation gates remain green except for explicitly satisfied external
  blockers.
- Paid live smoke passes with a real provider key and actual model.
- The dogfood pack passes twice: once fresh and once after sidecar restart.
- Safety, consent, checkpoint/restore, budget/cancel, transcript, memory, ledger,
  and artifact paths are proven by evidence.
- `fs.patch`, MCP stdio, browser automation, desktop computer-use, and desktop
  release build are either green or explicitly out of beta scope.

## Loop Algorithm

Every Phase 3 session follows this loop:

1. Run `npm.cmd run phase3:loop`.
2. Open `.dogfood/phase3-latest/summary.md`.
3. Work the first non-pass row only.
4. Patch the smallest surface that makes that row true.
5. Run the slice-specific test plus `npm.cmd run phase3:loop`.
6. Record whether the row is pass, blocked, or deferred for beta scope.

The loop stops instead of spinning when the state is blocked on external input:
provider key, Cargo/Rust, attended live UI proof, or unimplemented parity work.

## Phase 3.1: Live And Dogfood Runner

Goal: convert the Phase 2 checklist into repeatable evidence.

Runner:

```powershell
npm.cmd run dogfood
```

Done:

- `live-smoke` passes.
- `audit-live` passes.
- Replay-backed research plus file proof passes.
- Shell/verify, cancel/budget, persistence, memory, and restore proofs pass.
- Attended UI dogfood evidence is attached: screenshots, run ids, transcript ids,
  artifact paths, and ledger rows.

First blocker today:

- No live provider key is available, so live proof remains blocked.
- The attended UI proof still needs a human browser/desktop pass.

## Phase 3.2: Reliability Soak

Goal: prove StarNet behaves boringly across repeats.

Done:

- Two complete dogfood passes are green.
- One pass starts from a clean seeded workspace.
- One pass happens after sidecar restart.
- No pass loses transcript, model, spend, artifact, or memory provenance.

This does not begin until Phase 3.1 is green.

## Phase 3.3: `fs.patch`

Goal: close the reference harness patching gap with a safe, atomic workspace patch tool.

Required shape:

- `sidecar/tools/builtin/patchparse.js`
- `sidecar/tools/builtin/fuzzymatch.js`
- `fs.patch` registered by `sidecar/tools/builtin/fs.js`
- `test/fs.patch.test.js`

Done:

- V4A patch format parses.
- Multi-hunk patches validate all hunks before any write.
- Failed second hunk leaves the file byte-identical.
- Jail escape attempts are rejected before I/O.
- Fuzzy matching handles whitespace/indent drift with uniqueness guards.

## Phase 3.4: MCP Stdio

Goal: match the reference harness's practical MCP reach without weakening StarNet's local safety.

Required shape:

- `sidecar/mcp/transport.stdio.js`
- manager wiring for `transport: "stdio"`
- `test/mcp.stdio.test.js`

Done:

- Real child process newline-framed JSON-RPC test passes.
- Command allowlist and env redaction are enforced.
- Mutating MCP tools remain consent/capability gated.
- E-stop and shutdown reap child processes and process groups.
- HTTP MCP tests keep passing.

## Phase 3.5: Browser Automation

Goal: add browser automation after the core loop is proven.

Required shape:

- `sidecar/tools/builtin/browser.js`
- `test/browser.test.js`

Automated-contract done:

- Navigate, snapshot, click, type, scroll, back, press, console, dialog, get_text,
  and vision actions are available.
- Snapshot refs are stable only until the next snapshot.
- Stale refs fail explicitly.
- SSRF/private URL and redirect guards hold.
- Chromium-missing state degrades gracefully.

ref-parity proof remains Phase 4 work:

- A fixed live task succeeds at least 9 out of 10 times without coordinate fallback.

## Phase 3.6: Desktop Computer-Use

Goal: add real desktop control without making the harness dangerous.

Required shape:

- `sidecar/tools/builtin/computer.js`
- `test/computer.test.js`

Automated-contract done:

- Action enum matches the intended ref-compatible surface.
- Mutating actions require explicit consent.
- Autonomous runs cannot drive desktop actions from cached grants.
- Destructive key combos and command-like type patterns are hard-blocked.
- `capture_after` verifies successful actions.

ref-parity proof remains Phase 4 work:

- Attended Windows proof shows real UI action and cursor/focus invariants.

## Phase 3.7: Desktop Release Proof

Goal: classify StarNet's desktop build as beta-ready or externally blocked.

Done:

- `npm.cmd run desktop:prepare` passes.
- Cargo/Rust is on PATH.
- `npm.cmd run desktop:build` passes.
- Sidecar boot, key handling, update config, and local evidence are documented.

Cargo missing is an external toolchain blocker, not a product failure.

## Beta Go/No-Go

Go:

- `npm.cmd run phase3` verdict is green, or every remaining blocked row has an
  explicit beta-scope acceptance from the user.
- Paid live dogfood passes.
- Two dogfood passes survive restart.
- Safety/restore proof is green.
- The desktop path is either built or consciously accepted as a non-beta blocker.

No-go:

- Live provider path has not passed.
- Any real task can lose transcript, artifact, model identity, or spend truth.
- Mutating tools can bypass consent or restore evidence.
- A missing browser/computer/MCP/patch surface is accidentally reported as green.
