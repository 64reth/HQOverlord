# HARNESS GAP — 2026-07-25

> **Historical baseline only.** Superseded for 0.10 release decisions by
> [`HARNESS_GAP_2026-08-07.md`](HARNESS_GAP_2026-08-07.md), which compares StarNet 0.9.0 with the
> 2026-08-07 Hermes `origin/main`. Keep this document as evidence of which gaps were subsequently closed.

Where StarNet's agent runtime stands against the reference harness, measured against the friction
users have actually reported. Code-verified at trunk `dc594624`; plan docs were not trusted.

**Staleness caveat.** The reference clone used for this pass is pinned at 2026-07-08 and upstream has
moved since. Everything attributed to the reference harness below is true as of that snapshot. Re-sync
before building against any specific claim.

---

## 1. The finding

The gap is not a feature list. StarNet has nearly every capability the reference harness has. The
difference is **which surfaces get them**.

The reference harness ships one core tool bundle inherited by every CLI, messaging and scheduled
platform — terminal included, at 100%.

StarNet runs five independent gates before a tool reaches the model:

| # | Gate | Location |
|---|---|---|
| 1 | `isTask` — a non-task run gets an **empty** tool array | `sidecar/index.js:8731` |
| 2 | Capability projection from placed room objects | `sidecar/capability/resolve.js:44` |
| 3 | Toolset kill-switch (user-disabled capId families) | `sidecar/capability/resolve.js:48` |
| 4 | `enforceSyntheticOnly` — strips `computer.use` / `desktop.open` | `sidecar/inputpolicy.js:119` |
| 5 | `enforceRunAuthority` — per-tool impact class vs run surface | `sidecar/inputpolicy.js:56` |

Gate 5 is the one that bites. It kills `shell.exec` and `verify.run` on **every non-interactive
surface**, explicitly "even under Full Access"; every MCP connector tool (`external-unknown`); and all
Spotify tools including read-only ones.

Only two callers pass `surface:'interactive'`: the browser `/api/run` (`index.js:8116`) and a chat that
has run `/approvals on` (`channels/hub.js:801`). **Cron, night shift, workshop, delegated workers, and
every chat channel by default are `'autonomous'`.**

Net: an unattended StarNet agent has web, files, memory and studio. No shell. No connectors.

`workbench` is also absent from `fullOffice()` (`sidecar/capability/office.js:21`) and from the
interactive floor, so terminal reach requires a placed prop *and* a watched session.

### The architectural distinction

**The reference harness gates unattended danger with consent policy. StarNet gates it with tool absence.**

Their scheduled runs default to deny-on-approval, plus prompt-injection scanning and fail-closed
provider-drift checks — but the agent still *sees* the tool and reports the blocker honestly.

StarNet removes the tool before the consent broker is ever consulted, so the agent does not know the
capability exists. It over-promises, fails, and blames the user's credentials.

**StarNet already has the correct pattern.** `web_request`'s per-key unattended grant
(`sidecar/permissions.js:100-108`) is exactly consent-instead-of-absence: recorded, revocable,
per-resource. Extending that shape to `workbench` is the highest-leverage change available — and it is
precedented in this codebase, not imported.

---

## 2. The reframe — most user friction is not a parity gap

A sweep of the reported-issue corpus found ~72 distinct user-hit reports across 12 themes. **Only about
18 have any parity analogue at all.**

| Theme | User reports | Parity gap? |
|---|---|---|
| Connecting an API / provider / key | 7 | **Yes** |
| Long tasks can't finish | 4 | Partly |
| Agent's reach into the real world | 2 (+7 audit) | **Yes** |
| Agent picks the loudest path | 5 | Already closed (task doctrine) |
| Data loss · autonomous work invisible · delivered work unfindable · COMMS clutter · app-lies · vocabulary · cross-device · memory nagging | **~54** | **No analogue** |

The largest single cluster — autonomous work invisible, 9 reports — is almost entirely wiring. The
engine worked in nearly every case; the user could not see it. Three separate escapes on that one
surface inside five days.

Two independent audits reached the same sentence: **"engines shipped, the last hop to user value
missing."** That, not parity, is the dominant source of support load. Parity work addresses roughly a
quarter of it.

**The meta-gap neither harness solves:** 427 test files prove the app doesn't break; nothing measures
whether an agent completes work *well*. That is why these defects drifted invisibly.

---

## 3. Shipped in this pass

Rescued from an uncommitted worktree (704 insertions, one `git clean` from loss — the failure mode that
cost 7 features on 2026-07-09):

- **Tier-0 silent-corruption fixes** — transcript/compaction path, provider recovery path, per-model
  price catalog. `test:fast` 388 green, `test:http` green.

Honesty lane:

- `capsummary` no longer claims desktop control (`computer.use`/`desktop.open` carry no grant and are
  stripped unconditionally — that claim was a standing lie **to the model**).
- Capability presence is now derived from the surviving **headline tool**, not the capId. A capId can
  outlive its flagship tool: an autonomous run keeps `workbench`'s background-shell and browser-test
  tools while `shell.exec` and `verify.run` are stripped, so the old check reported shell as available.
- **Autonomous surfaces now receive a ground-truth block** instead of silence, stating the
  unattended-run limit and forbidding the agent from blaming credentials for an ungranted power.
- **Delegated-worker iteration cap wired end to end.** `orchestration.js` had always passed
  `maxIters`; `runOnce` never read it and the host never supplied `workerMaxIters`. Workers ran the
  lead's full 40. Now clamped downward only; ordinary runs byte-identical.
- The `SAME ACCESS AS THE ORCHESTRATOR` comment corrected — it described access the surface gate had
  already removed.

---

## 4. Ranked backlog

**Tier 1**

1. **Consent-gated autonomous shell** — apply the `web_request` unattended-grant shape to `workbench`.
   Closes the connection-friction theme structurally. Deliberately *not* shipped in a release-eve cut:
   it widens the permissions surface and deserves its own lane on clean trunk.
2. **Turn-end verification gate.** The reference harness keeps a passive SQLite ledger of what the agent
   actually *proved* (commands classified by kind and scope, invalidated by any later edit), then at
   turn end rewrites the finish reason when the model tries to conclude after editing code with no fresh
   passing evidence. Prose/markdown edits are excluded, it is capped at 2 attempts, it is off on
   conversational surfaces, and the synthetic messages are non-persistent so a resumed transcript never
   carries a premature "done". StarNet has `verify.run` — nothing forces it, nothing consumes its
   result, and it is dead on autonomous surfaces. This targets the project's #1 recurring failure mode.
3. **Tool descriptions as coaching, not description.** Pure prompt work. Their tool schemas teach: the
   web-extract tool names the exact follow-up call to page its own omitted middle; the clarify tool
   ships a right/wrong example pair; a write failure diagnoses the likely cause and names the
   alternative. StarNet did this once with the task doctrine — generalize it.
4. **Per-task auxiliary model slots.** Still open. `auxgovernor.js` capped the *count* of post-run
   passes, not their *model*, and it reads `process.env.SKYNET_AUX_BUDGET` directly — bypassing `ENV()`,
   so `STARNET_AUX_BUDGET` silently does nothing.

**Tier 2**

5. **Reshape the skill library toward service runbooks.** Theirs are mostly shell recipes for real
   platforms, with detection flows, decision trees and declared CLI prerequisites; StarNet's 48 teach
   thinking genres. This is how they reach platforms with no connector at all. Markdown — cheapest
   reach-per-hour available.
6. **Three-level tool-output budget** — per-tool truncation, per-result spill to disk with a preview and
   the exact command to page it, then a per-turn aggregate. The current per-run budget does not reset,
   so the agent goes blind while the loop keeps paying.
7. **History search depth.** `recall_conversation` searches only the bounded RAM mirror and cannot reach
   rotated transcript files. Their anchored result shape — first messages (the goal), a window around
   the hit, last messages (the resolution) — is worth copying even keeping BM25-over-JSON.

**Explicitly skip:** ensemble/mixture loops, broad channel breadth, external memory vendors, editor
protocol adapters, agent-as-tool-server. And do **not** copy their skill hub — it installs from ten
remote sources with no cryptographic provenance.

**Do not regress:** the reference harness has **no dollar-denominated spend cap anywhere**, and its
subagent budgets are not tree-bounded. StarNet's USD governance and consent broker are ahead.

---

## 5. Known defects found while measuring

Filed separately, not fixed here:

- `sidecar/index.js` declares `function runGit` **twice** in one module scope with different signatures
  (`:4262`, `:7234`); the second silently wins for the whole module. Pre-existing, shipped in v0.6.6.
- `CRON_MAX_RUN_MS` is documented as an ≈8-minute bound but resolves to ~20 minutes since `maxIters`
  moved 16→40, and that number also feeds cron lock staleness, heartbeat staleness and dispatch timeout.
- `allowedChats` is plumbed through every channel module and never passed, so group and guild messages
  are silently dropped on every platform.
- Non-Telegram channels share the `tg_` agent-id namespace and a chatId-keyed binding map — a collision
  hazard across platforms.
