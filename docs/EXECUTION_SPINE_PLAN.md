# Execution Spine — checkpoint → shell → verify

> **StarNet** — the plan to take the harness from "can edit files in a jailed sandbox" to "can actually
> run code, complete a real engineering goal, and prove it worked — safely." This is the #1 goal-completion
> gap vs the reference harness (which has six shell backends + LSP lint-delta; we have neither). It obeys the same
> discipline as `CRON_INTEGRATION_PLAN.md` / `REF_HARNESS_PARITY_PLAN.md`: pure-core / ambient-edge determinism
> split, a new `shared/events.js` rung **before** any producer, one revertable commit per step, the fast
> suite green before the next, and the gamification firewall (engine emits events; the world only observes).
>
> _Grounded against the real sidecar (2026-06-17): `runOnce` exists (`index.js:532`, accepts
> `surface`/`trigger`/`runId`/`prompt`/`station`); the consent ladder + hardline floor + autonomous
> default-deny are live (`permissions.js`, `index.js` `hardlineFloor`); the capability gate is
> object-placement based (`capability/capGate.js`, `resolve.js`); tools self-register fresh per run
> (`tools/builtin/fs.js` is the template); the per-agent fs jail is `WORKSPACES/<agentId>/`._

---

## 1. Why this order: safety BEFORE capability

The single most-emphasized rule in `CLAUDE.md` is that **silent data loss is THE failure mode.** A shell
that can run `rm`, `git reset --hard`, or a botched refactor is exactly how an autonomous agent destroys
work. So the ordering is non-negotiable: **the rollback net is built and proven before the thing that needs
it.** Checkpoints first, then shell, then verification that the shell's edits were good.

```
  1. CHECKPOINT  ── a per-turn shadow snapshot of the agent's workspace + rollback   (the safety net)
  2. FILE FLOOR  ── a resolved-abs-path deny floor that binds shell too, not just fs.* (the blast wall)
  3. shell.exec  ── run commands, gated by consent + an AUTO-checkpoint before each run (the capability)
  4. VERIFY      ── surface only NEWLY-introduced diagnostics / test failures after an edit (the proof)
```

Each is independently useful, but each later step assumes the earlier one. shell is never granted without
the checkpoint net behind it; verify is only meaningful once the agent can act.

---

## 2. What already exists and must NOT be re-built

| Capability | Where | Reuse for the spine |
|---|---|---|
| The sole run host `runOnce({...,surface,trigger,runId,prompt,station,emit,signal})` | `index.js:532` | shell/verify tools register into the same fresh per-run registry; no second engine. |
| The consent ladder: hardline → bypass(FULL_ACCESS) → cache(allowlist) → resolve(surface) | `permissions.js:81-99` | shell.exec is a **danger-gated** tool — it walks this exact ladder. Autonomous = default-deny. |
| `hardlineFloor` — refuses writes to `.env`/`.git` BEFORE any bypass | `index.js` (`hardlineFloor`) | extend the *concept* (not the function) into the abs-path floor §4; shell inherits it. |
| The per-agent fs jail `resolveInside(agentId, rel)` rejecting `..`/abs/drive/null | `tools/builtin/fs.js:39-52` | shell's `cwd` is the jail root; shell output paths are validated by the same proof. |
| Object-placement capability projection (`resolveTools`/`attenuate`/`canUse`) | `capability/resolve.js`, `capGate.js` | shell is a new capability bound to a new placeable object (the "workbench") — no host-side policy. |
| Fresh-per-run tool registration template | `tools/builtin/fs.js` | `shell.js` follows it verbatim (name, schema, handler, consent flag). |
| The determinism split (pure core + injected clock/io; lint-determinism scans `sidecar/`) | `cron.js` / `cron-store.js` / `loop.js` | checkpoint/verify get a PURE reducer (index/diff math) + an ambient edge (git/process) in `index.js`. |
| Secret redaction over every event payload | `context.js` `SECRET_PATTERNS`, `index.js` `redact()` | shell stdout/stderr is redacted before it reaches the bus/log — already free. |

**Genuinely new (rung-first or new module):** the checkpoint store + git plumbing, the `shell.exec` tool,
the verify/diagnostic-delta module, and **four additive `shared/events.js` rungs** (§7) — which the
`emitter` drops until registered, so they land via the cortex-memory owner first.

---

## 3. Checkpoint manager (Commit 1) — the safety net

**Goal:** before every *mutating* turn, snapshot the agent's workspace so any turn can be rolled back,
invisibly to the model. Pairs with the worktree model: worktrees isolate *agents from each other*;
checkpoints isolate *an agent from its own past turns*.

- **Pure core — `sidecar/checkpoint.js`:** a reducer over a snapshot index
  `{ version:1, snapshots:[{ id, runId, turn, parentId, ts, files:int, bytes:int, label }] }` — append, prune
  (keep last N per agent + per-run head), resolve "snapshot for run R turn T", compute the rollback target.
  No fs, no clock, no rng — `now`/`id` injected. Headless-testable like `cron-store.js`.
- **Ambient edge — `index.js`:** a **content-addressed shadow store** under `WORKSPACES/.checkpoints/<agentId>/`
  (a sibling of the fs jail, so the agent's own `fs.*`/`shell` can neither read nor rewrite its own history).
  Recommended mechanism: a **shadow git repo** (`git --git-dir=.checkpoints/<aid>/.git --work-tree=WORKSPACES/<aid>`)
  — `add -A` + `commit-tree` per snapshot gives content-addressing, dedup, and cheap diffs for free, with
  zero new deps. Snapshots are taken **before** the first mutating tool of a turn (lazy: read-only turns cost
  nothing). Restore = `git restore` to a snapshot tree. Emit `checkpoint.created` / `checkpoint.restored`.
- **Rollback surface:** `POST /api/checkpoint/restore {agentId, snapshotId}` + a war-room "rewind" affordance;
  also the auto-rollback hook used by shell consent-deny / verify-fail policies (§5/§6, opt-in).
- **DoD:** snapshot before a mutating turn → edit a file → restore → file is byte-identical to pre-turn;
  read-only turn creates no snapshot; the shadow store is unreachable from `fs.*`/`shell` (jail test).

**Open decision (carry from REF_HARNESS_PARITY_PLAN §7.8):** snapshot the *whole* `WORKSPACES/<aid>` per mutating
turn, or only touched files? *Recommendation: whole-workspace via shadow-git* (content-addressed, so
unchanged files cost nothing) — confirm given disk across 7–10 simultaneous worktrees.

---

## 4. File-safety deny floor (Commit 2) — the blast wall shell needs

`fs.*` is already jailed to `WORKSPACES/<agentId>/`. **shell breaks that assumption** — a subprocess can
`cd` anywhere and write anything the OS user can. So shell needs a floor of its own:

- **`cwd` is pinned** to the agent's jail root; relative paths resolve inside it.
- **A resolved-abs-path deny floor** (generalize `hardlineFloor`): refuse a command whose resolved targets
  touch `.env`, `.git`, the checkpoint store, `permissions.allow.json`, the notebook sidecar, or anything
  outside the agent's workspace — checked AFTER resolution so `../` tricks can't dodge it. This is a *floor*,
  below FULL_ACCESS, never escapable (mirrors `hardlineFloor`'s position in the ladder).
- This commit is small but is the precondition for shell being safe to ship at all.

---

## 5. `shell.exec` (Commit 3) — the capability

- **New tool `sidecar/tools/builtin/shell.js`** following the `fs.js` template: `shell.exec({ cmd, timeoutMs? })`
  → spawns a child in the jail `cwd`, captures stdout/stderr (capped to `maxToolBytes`, redacted), returns
  `{ exitCode, stdout, stderr, truncated, ms }`. Per-call timeout (default the existing `toolTimeoutMs`),
  hard output cap, and **abort on `signal`** so E-STOP / budget / supersede kill it instantly.
- **Capability-gated:** shell appears only when a **"workbench"** object is placed in the agent's room
  (new `CAP_REGISTRY` entry → `resolveTools`). No object, no shell — same model as `cabinet`=files.
- **Consent-gated:** shell is a danger capability. It walks the existing ladder (`permissions.js`):
  - `surface:'interactive'` → prompts live (Run / Always / Deny) per the existing PROPTERM flow.
  - `surface:'autonomous'` (cron / unattended) → **default-deny** unless the danger class is pre-blessed in
    `permissions.allow.json` — exactly the cron unattended-consent keystone. No "approve everything" switch.
- **Auto-checkpoint:** the host snapshots (Commit 1) **before** dispatching a shell call, so any command is
  one rollback away. This is the coupling that makes shell safe — it is a DoD assertion, not prose.
- **DoD:** `shell.exec("echo hi")` returns exit 0 + "hi"; a write outside the jail is floor-denied; an
  ungranted shell under `surface:'autonomous'` default-denies; an auto-checkpoint exists before the call;
  `signal.abort()` kills a `sleep 999` within the lease.

> **Sandbox model (open decision).** v1 runs a **local subprocess inside the per-agent jail + checkpoint +
> floor + consent** — no container. This is *stronger than the reference harness's `local` backend* (which has no
> checkpoint/rollback at all) and ships with zero new deps. *Recommendation: ship local-in-jail first;*
> defer the container/Modal/SSH backends the reference harness carries (they are deployment isolation, not a goal-
> completion blocker) behind the same tool seam.

---

## 6. Verification (Commit 4) — the proof

"Reliability" means *did it actually work.* Today the agent can't tell if an edit broke anything.

- **Cheap, high-value first — test/build runner surfacing:** once shell exists, a thin `verify.run` that
  executes the project's own check (`npm test` / `npm run build` / a configured command) in the jail and
  emits `verify.result { passed, summary, added, removed }`. This is the 80/20 — it directly answers "did my
  change pass the suite."
- **Then LSP lint-delta (`sidecar/verify.js`, pure diff core):** after `fs.write`/`fs.edit`/a shell edit,
  run diagnostics (tsserver/eslint via the now-present shell) and surface **only newly-introduced** ones
  (pure before/after delta — the noise filter the reference harness's `_check_lint_delta` does). Git-workspace gated.
- **DoD:** an edit that breaks the build surfaces a `verify.result{passed:false}` with the new error; a
  clean edit surfaces `passed:true` with no false positives from pre-existing diagnostics.

---

## 7. The additive event rungs (cortex-memory owner, FIRST)

The `emitter` drops unregistered names, so these land in `shared/events.js` (via the cortex-memory owner,
then cherry-picked to trunk) **before** any producer. All additive — no rename/removal.

```
checkpoint.created   { agentId, runId, turn:int, snapshotId, files:int, bytes:int, label? }
checkpoint.restored  { agentId, runId, toSnapshotId, reason }
shell.exec           { agentId, runId, callId, cmdSummary, cwd, exitCode:int, ms:num, truncated:bool }
verify.result        { agentId, runId, tool, passed:bool, added:int, removed:int, summary }
```

(`shell.exec` is richer than the generic `agent.tool_result` so the war-room can render exit code / duration;
the firewall rule — emit a richer rung rather than reach into the world — is exactly why.)

---

## 8. Gamification firewall (unchanged principle)

Every byte of truth lives in `sidecar/` + `WORKSPACES/`; the world only observes the rungs above.
- Checkpoint = a **save-crystal / time-rewind** VFX off `checkpoint.created/restored`.
- shell = a **powered workbench**; the agent "badges in" (consent) before it runs off `shell.exec`.
- File floor = a **red forcefield** on `.env`/`.git` off `capdenied`.
- verify = **X-ray goggles**; pass/fail glow off `verify.result`.
- Hard rule: `checkpoint.js` / `verify.js` / `shell.js` NEVER import `world.js`. Arrow points one way.

---

## 9. Build order & open decisions

**Order:** rungs (cortex-memory) → checkpoint core+edge (C1) → file floor (C2) → shell.exec (C3) →
verify test-runner then lint-delta (C4). Each one commit, fast suite green before the next.

**Open decisions for andro:**
1. **Checkpoint scope** — whole-workspace shadow-git (rec) vs touched-files-only. Disk vs simplicity.
2. **Shell sandbox** — local-in-jail+checkpoint v1 (rec) vs container backend now.
3. **Shell pre-bless policy** — which danger classes (if any) may be pre-blessed for *unattended* (cron)
   shell, vs interactive-only. *Recommendation: interactive-only by default; no autonomous shell pre-bless
   without an explicit per-agent grant.*
4. **Auto-rollback on verify-fail** — should a failed `verify.result` auto-restore the pre-turn checkpoint,
   or only flag it? *Recommendation: flag-only (surface + let the agent decide); auto-rollback opt-in.*
