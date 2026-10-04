# State Integrity — the goal + the loop

> Hardening pass against ONE bug class: **module-level singleton state that is reused
> across lifecycle transitions without being reset, so a previous context leaks into a
> new one.** The founding example: NEW AGENT kept the previous agent's summoned crew
> bodies (fixed in `agent/newagent-reset`). This system finds and kills every sibling of
> that bug, to a fixed standard, without stepping on other agents' worktrees.

## 1. Why this class exists

StarNet is a long-lived single-page app. The page is loaded **once**; everything after —
waking an agent, resuming a save, pausing to the title screen, creating a NEW AGENT,
summoning crew, refitting the station, switching workstreams — happens by **re-driving
module singletons that stay alive in memory**. Each transition is supposed to reset or
restore the relevant state. Where a reset is missing or asymmetric, the previous
context bleeds through. Because there is no page reload, the leak is invisible to any
test that starts from a fresh load — exactly why the crew bug survived.

## 2. The lifecycle transitions (the rows)

All happen **without a page reload**:

| Transition | Entry point | Intent |
|---|---|---|
| WAKE | `app.js onWake → enterGame({awaitingPurpose:true, wake:true})` | brand-new agent — must be byte-indistinguishable from a fresh page load |
| RESUME | `app.js resumeInto → enterGame({wake:false})` | restore the saved context **exactly**, nothing more, nothing less |
| DISCONNECT | `app.js disconnect()` → title | release everything tied to the live agent (timers, streams, audio, panels) |
| NEW AGENT | `Save.clear() → startCreation() → WAKE` | a full from-scratch restart of agent + station |
| SUMMON | `summonAgent()` | add ONE crew member; touch nothing else |
| REFIT | Build edits → `World.loadStation` | re-derive the floor; drop anything bound to the old layout |
| WS-SWITCH | `switchWorkstream → Chat.load(ws)` | repoint COMMS/run identity; leak no other stream's state |

## 3. The invariant (the standard)

> **After any transition, no module may retain mutable state, listeners, timers, audio,
> or network streams that belong to the prior context.**
>
> - A **WAKE / NEW AGENT** result is indistinguishable from a fresh page load.
> - A **RESUME** restores exactly the saved slice and nothing the previous live session
>   accreted in memory.
> - A **DISCONNECT** releases every live resource (no background polls/streams/timers,
>   no audio, no open panels) — the title screen is quiet.
> - Every "open once per page" resource is paired with a "release on disconnect / re-arm
>   on re-entry" — *guarding against duplication is not enough; un-released is also a bug.*

## 3a. Voice ownership (a product invariant, decided 2026-06-23)

> **Only the orchestrator (the hero, agent id `'agent'`) has a voice.** Summoned /
> secondary agents NEVER speak aloud and are never given the short spoken-reply style.

A secondary agent exists for the orchestrator to **delegate** to — the Commander talks to
the orchestrator, not to a crowd of agents. Enforced at the one TTS gate in `chat.js`
(`willSpeak` requires the active stream's agent be the orchestrator). Ambient mutters are
already hero-only (crew bodies render silent speech bubbles, never `Voice.mutter`).

## 4. Definition of Done (per finding — the bar every fix clears)

A finding is **BULLETPROOF** only when ALL of:

1. **Reproduced** — live (preview instrumentation, the way the crew bug was) or by a
   failing automated test. A finding that can't be reproduced is downgraded, not fixed blind.
2. **Root-caused** — named to the exact module-level state / listener / timer / stream.
3. **Fixed minimally + additively** — reset at an existing reset point, or a new
   teardown paired with the existing setup. No renames/removals of shared API. Never
   touch `shared/events.js` / `shared/schema.js` (owned by `cortex-memory` — request changes).
4. **Regression-guarded** — an automated test where the seam is testable in node; where it
   is canvas/DOM-bound, a **documented live-verification recipe** (exact preview steps +
   the observable) recorded in the ledger.
5. **Green** — `npm run test:fast` passes fully.
6. **Recorded** — ledger row moved to FIXED with the commit, and the matrix cell marked.

## 5. The loop (one iteration = one finding to standard)

```
1. SELECT  → open LEDGER.md; take the highest (severity, confidence) OPEN finding
             whose file is not currently HOT-contested (see §6).
2. CONFIRM → read the module; enumerate its module-level state + side-effects
             (listeners / timers / SSE / audio / bus subs). Verify the leak is real.
3. REPRODUCE → instrument live (expose state via World.dbg-style hooks) OR write a
             failing test. Capture the BEFORE observable.
4. FIX     → surgical, additive, at the right reset point. One file per commit where possible.
5. GUARD   → add the regression test, or record the live-verification recipe.
6. VERIFY  → npm run test:fast green; live AFTER observable confirms the fix; confirm the
             symmetric transition (e.g. RESUME) is NOT regressed.
7. SYNC    → sync-agent-tree.ps1 state-integrity   (rebase onto trunk; resolve in MY tree)
8. MERGE   → only if the file isn't HOT right this second; else mark HELD-FOR-COORDINATION.
9. RECORD  → update LEDGER.md (status, commit, verification); commit only MY files.
→ repeat.
```

Self-paced: one finding per iteration. Stop when every OPEN row is FIXED, HELD, or
WONTFIX-with-rationale.

## 6. Isolation rules (respecting the other ~20 sessions)

This repo is built by many agents in parallel. These are non-negotiable:

- **All work happens in `C:\Users\<you>\gen-trees\state-integrity` on `agent/state-integrity`.**
  Never edit another worktree or `agent/*` branch.
- **Commit only my files, by pathspec.** Never `git add -A` / `git add .`.
- **Additive only.** Fixes add resets/teardowns at existing seams; they don't rename or
  remove anything other code depends on. This makes merges conflict-free in practice.
- **Never edit `shared/events.js` / `shared/schema.js`.** Request additive changes from the
  `cortex-memory` owner.
- **HOT-file discipline.** `world.js` and `app.js` change every few minutes. Before merging a
  fix that touches them: `sync-agent-tree.ps1` *immediately* before the merge, merge fast,
  and re-run the gate on trunk. If a sync surfaces a conflict, resolve it in this worktree.
- **When in doubt, HOLD.** A fix that's ready but lands in a file another agent is actively
  rewriting gets marked **HELD-FOR-COORDINATION** in the ledger (with the diff ready) rather
  than force-merged. Better a staged patch than a clobber.
- **Green before merge. Sync before merge.** (Repo law.)

## 7. Scope guard (what this is NOT)

- Not a general refactor. Only the reset-on-transition class.
- Not a behavior change. A fix must not alter what a *correct* session already does.
- Borderline "is this leak or intended product behavior?" rows (e.g. station-wide
  once-ever tutorial flags) are flagged **NEEDS-PRODUCT-CALL**, not silently changed.
