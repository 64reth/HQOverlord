# The Commander Dossier — agents that deeply research and get to know the user

**Status:** Design locked 2026-06-18. Phase A specced for build; B–D specced at altitude.
**Origin:** andro's "Skynet as a harness whose agents deeply research the user and get to know
the user." Expands the shipped Personalization work (`docs/PERSONALIZATION_PLAN.md`) from a thin,
per-agent affinity vector into a **station-wide, dimensioned, actively-acquired model of the
human** that the whole station shares and shows its work on.

---

## 1. The reframe (what's new vs. what shipped)

Personalization (shipped) answers a narrow question — *"what kinds of work does this user ask
for?"* — with a 3-bucket affinity vector (`frontend/app/profile.js`) that re-sorts catalogs.
Cortex can also store `kind:'profile'` beliefs about the user with provenance + trust.

The substrate audit exposed the gap this project targets:

- The user model is **thin** (3 tags) and **scattered** across four unconnected places — the
  affinity vector, per-agent Cortex beliefs, one-shot onboarding docs, and the mint detector.
- It is **per-agent**. Spawn a second agent and it knows *nothing* about you — starts blank.
- It is **100% passive and reactive** — the agent never *deliberately* tries to learn about you;
  it only proposes a fact if one happens to fall out of a finished run.

"Get to know the user" is a bigger thing than "learns how you work." This plan promotes the user
model to a **first-class, station-wide entity** (the *Commander Dossier*), makes acquisition
**active** (the station *studies* its Commander), and **feeds it back** so every agent visibly
knows you.

**Positioning sentence:** *A station that gets to know its Commander — one shared, local-first
dossier every agent reads, that the station actively works to fill in, and that you fully own and
control.*

---

## 2. Locked decisions (andro, 2026-06-18)

1. **Scope = station-wide (shared).** ONE canonical Commander dossier that every agent reads; a
   newly-spawned agent knows you on day one. (Implication: a true cross-agent durable belief layer
   eventually needs an additive `scope:'user'` in the Cortex contract, owned by the
   `cortex-memory` workstream — see §10. Phase A sidesteps this with a local dossier store so it
   ships without blocking on contract coordination.)
2. **Acquisition = interview + curiosity (no outside-the-conversation research yet).** Passive
   observation PLUS a diegetic intake interview and budgeted just-in-time questions. The agent
   asks *you* directly; it does not read external sources in this design. (Consent-gated source
   research — repo/profile/folder — is deferred to a future, separately-opted-in phase.)
3. **First build = Phase A (Unify + Dossier panel).** Make the scattered model coherent,
   station-wide, visible, and editable first; everything else writes into that foundation.

---

## 3. Principles (inherit the Personalization charter)

- **Local-first, provably.** The dossier lives on the user's machine (localStorage, own key). No
  central server. The trust promise is architectural: *"your dossier, 0 bytes sent."*
- **Glass box.** One panel shows everything the station has learned about you, each belief with
  provenance; edit / forget / pause / export — the thing cloud assistants can't match.
- **Honest about confidence.** Cold dimensions say "unknown" / "calibrating," never a fabricated
  certainty. Reuse the existing Confidence% honesty pattern.
- **Consent-shaped, not consent-fatiguing.** Passive *derived* signal (tag histograms, never raw
  prompt text) folds silently, same justification as the agent notebook. Any *durable stated fact
  about the user* rides the locked Keep/Edit/Discard memory-formation gate. Active questions are
  hard-budgeted (anti-nag).
- **Reflect only what's observable.** Never "I noticed you're job-hunting." Surface what was said
  or shipped; durable inferences go through the gate; never quote raw history back.
- **Additive contract only.** `shared/events.js` / `shared/schema.js` are owned by `cortex-memory`
  and additive-only for everyone else. The Dossier store must NOT emit a bus event — it consumes
  read-only and acts via direct calls, exactly like `xpstore.js` / `profilestore.js`.

---

## 4. The substrate we already have (grounded)

| Signal / surface | Where | Scope today | Persistence |
|---|---|---|---|
| Interest tag `{code\|research\|general}` per message | `classify.js getTag()` → `profilestore.observeMessage()` | per-agent | save envelope (`save.profile`) |
| Affinity vector (EWMA, 14-day half-life) | `profile.js` `vector/summary/score/explain` | per-agent | save envelope |
| Onboarding docs (identity/purpose/context/manual) | `onboarding.js` → `app.js composeSystemPrompt` (app.js:63–79) | per-agent free-text | save envelope (`agent.docs`) |
| Durable user beliefs (`kind:'profile'`) | Cortex: `sidecar/reflect.js`, `memcore.js`, `notebook.js`; §5.2 record | **per-agent** notebook JSON | `sidecar/workspaces/<agentId>.notebook.json` |
| Recurring-ask shapes | `mint.js` / `mintstore.js` | per-agent | `skynet.mint.v1` |
| Shipped deliverables (strong outcome signal) | `workstreams.js` → `workitem.delivered` | per-agent | save envelope |
| Memory Core panel (view/pin/edit/forget beliefs, provenance + trust) | `stationui.js` MEMORY tab (`agMemory`/`loadMemoryCore`/`memCard`) | per-agent | — (reads sidecar) |
| Memory contract events | `shared/events.js` `memory.{recall,write,forget,proposed,used,feedback}` + `scope:'global'\|'stream'` field | frozen | — |

**The reusable machinery is almost all here.** The §5.2 record shape, the Keep/Edit/Discard
gate, the reflection engine, the Memory Core provenance panel, the consent prompts, the cron
scheduler, and the affinity vector all exist. This plan mostly **unifies, widens the scope, and
makes acquisition active** — it builds little new plumbing.

**Gaps to close:** no aggregation across the four sources; no station-wide (cross-agent) view;
no structured dimensions beyond 3 tags; no deliberate intake; no curiosity questions; the model
isn't composed back into the system prompt as a coherent "who is the Commander" block.

---

## 5. The dossier data model

**Two layers, mirroring Personalization's A/B split.**

**Layer A — the affinity vector (unchanged).** `profile.js`'s histogram stays the recommender's
fuel. The dossier *reads* it for the "what you work on" dimension; it is not rewritten.

**Layer B — the dimensioned belief set (the new core).** A small set of named **dimensions**,
each holding human-readable beliefs with provenance + trust:

| Dimension | Examples | Primary source |
|---|---|---|
| `identity` | role, what you're building, timezone / typical work-hours | interview, onboarding `context` |
| `stack` | languages, frameworks, the tools you reach for | observation (tags + deliverables), interview |
| `goals` | current objectives, active projects (living, not the one-shot PURPOSE) | interview, workstream titles, reflection |
| `style` | concise vs. detailed, autonomy tolerance, how you want to be reported to | curiosity questions, reflection |
| `standing_orders` | conventions, do's/don'ts | onboarding `manual`, curiosity |

A belief is the §5.2 Cortex record, reused verbatim, with two notes:
- **Scope.** The durable cross-agent target is `scope:'user'` (new, additive — §10). **Phase A
  does not depend on it:** the dossier is a station-local object (`skynet.dossier.v1`) that
  *aggregates* existing per-agent `kind:'profile'` records + the affinity vector + onboarding docs
  into one view, and stores any *new* dimensioned beliefs locally. Phase C migrates the new
  beliefs to real `scope:'user'` Cortex records once the contract owner adds the scope.
- **Honesty.** A dimension with no beliefs renders "unknown — the station hasn't learned this
  yet," never a guess.

**Signal weighting (inherit from Personalization §4):** an *asked-for* topic is weak; a *shipped
deliverable* is strong; a *stated fact* (interview / curiosity answer) is strongest and is the
only thing that writes a durable belief. Contradictions are never hard-deleted — EWMA decays a
stale declaration as fresh behavior accrues; durable beliefs are superseded through Keep/Edit.

---

## 6. Active acquisition — the station studies its Commander (Phase B)

Today the model only grows by accident. Add two deliberate, gamified, in-voice acquisition paths:

- **The Intake Interview.** A short, optional, skippable interview at/after awakening, in the
  awakening voice (reuse `Chat.typeLine`/`Chat.choices`/`onboarding.js` beats), richer than the
  single PURPOSE line. ~4–6 high-leverage questions, one per dimension (stack, work-hours, report
  style, current goal…). Each answer → a durable dossier belief via the Keep/Edit/Discard gate.
  The interview is *the station getting to know you*, framed diegetically, not a settings form.
- **Just-in-time curiosity.** When an agent hits an unknown that would change how it works ("I
  don't know your test runner / how terse you want reports / your timezone for this schedule"), it
  asks **once**, banks the answer as a belief, and never asks again. Hard-budgeted (a per-session
  cap, same discipline as the consent prompts) so it never nags. Reuses the consent-row UI
  pattern in `chat.js`.

Both paths write through the **existing** memory-formation gate — nothing about the user becomes
durable without a one-click Keep. (Source research — reading your repo/profile/a folder — is
**out of scope** for this design per the locked decision; it is a clearly-bounded future opt-in.)

---

## 7. Feeding it back — the station visibly knows you (Phases A + D)

- **System-prompt composition.** A compact, cached **COMMANDER block** (the Cortex PROFILE/LEARNED
  core-prefix pattern) is composed into *every* agent's system prompt by `app.js composeSystemPrompt`
  — so a newly-spawned agent inherits the dossier and knows you on day one. Capped + deterministic;
  frozen per run so the cache stays warm (Cortex's living-core discipline).
- **STATION FAMILIARITY meter (Phase D).** The existing "calibrating → %" meter graduates into a
  **dimensioned** readout — which dimensions are known, which are still blank — reusing the honest
  Confidence% pattern. "All five dimensions known" is the visible payoff of getting to know you.
- **The re-sort already reads it.** The shipped "Recommended for you" shelf consumes the same
  model; a richer dossier sharpens it for free.

---

## 8. Privacy & the glass box (the moat)

- **`learningEnabled` is the single switch.** Reuse the existing flag (the glass-box PAUSE/FORGET
  in `marketplace.js`) — it already cascades to `profilestore` + `mintstore`; the Dossier store
  honors the same flag on every write path. Pause = stop folding; existing data stays until forgotten.
- **The Commander Dossier panel.** Extend the Memory Core surface (`stationui.js`) into a
  dimensioned dossier: every belief under its dimension, with provenance (which signal, when, how
  many samples / `sourceRunId`), trust meter, pinned; inline edit / two-step forget / export / wipe.
  It is the "everything the station knows about you" screen — local-only, the cloud can't match it.
- **Export/import (Phase D).** The dossier rides the `skynet.` backup prefix (like mint), so it
  exports/imports with no `backup.js` change — *your* model, portable, the value-lock-in (not
  hostile lock-in) the Personalization moat rests on.

---

## 9. Phase plan

| Phase | Scope | Ships |
|---|---|---|
| **A — Unify (first build)** | Aggregate the four scattered signals into one station-wide Dossier object + a dimensioned Dossier panel + compose the COMMANDER block into the system prompt. No new acquisition. | `frontend/app/dossier.js` (pure), `dossierstore.js` (wiring), `stationui.js` Dossier panel, `app.js composeSystemPrompt` hook, `save.js` v5 slice, `skynet.dossier.v1`, `test/dossier.test.js` |
| **B — Active intake** | The Intake Interview (post-awakening) + just-in-time curiosity questions, banked as beliefs via Keep/Edit/Discard. | `onboarding.js` interview beats; `chat.js` curiosity-row; budget guard |
| **C — Durable cross-agent beliefs** | Request the additive `scope:'user'` from the contract owner; migrate the local dossier beliefs to real `scope:'user'` Cortex records so provenance/trust/recall apply across agents. Optional scheduled "study the Commander" cron routine. | contract request; `reflect.js` user-scope; cron routine |
| **D — Payoff polish** | Dimensioned STATION FAMILIARITY meter + export/import + cross-agent inheritance verified end-to-end. | `marketplace.js` meter; `backup.js` (free); QA |

Each phase is independently shippable and test-gated, smallest-first — the marketplace cadence.

---

## 10. Phase A spec (building first)

Mirrors the proven **pure-engine / browser-wiring** split (`profile.js` / `profilestore.js`).

### `frontend/app/dossier.js` — the pure engine (UMD, node-testable, clock injected)
- `fresh()` → `{ v:1, dims:{ identity:[], stack:[], goals:[], style:[], standing_orders:[] }, updatedAt:0 }`
  where each dimension is an array of `{ id, text, source, sourceRunId, createdAt, trust, pinned }`.
- `aggregate({ profile, docs, memories }, now)` → a **read projection**: folds the affinity
  vector (Layer A) + onboarding `docs` (identity/purpose/context/manual → seed beliefs) +
  existing `kind:'profile'` memories into the dimensioned view. Pure; no writes.
- `upsert(dossier, dim, belief, now)` / `forget(dossier, dim, id)` — durable-belief mutation
  (first-match-only, collision-proof ids — reuse the `memcore.nextNoteId` discipline).
- `composeBlock(dossier, { maxChars })` → the compact, deterministic COMMANDER system-prompt
  block (capped; "unknown" dimensions omitted, never guessed). The single thing the prompt reads.
- `summary(dossier)` → `{ known:[dims], blank:[dims], familiarity }` for the panel + meter.
- **No `Date.now`/`Math.random`** — `now` injected, matching the profile/xp engines.

### `frontend/app/dossierstore.js` — the browser wiring (near-clone of `profilestore.js`)
- `init({ dossier, persist, profileStore, agentDocs, memories })` — load the saved slice or
  `Dossier.fresh()`, then `aggregate(...)` for the read view. **Never emits on `U.bus`.**
- Honors the shared `learningEnabled` flag on every write path.
- `serialize()` · `summary()` · `composeBlock()` · `upsert()` / `forget()`.

### Hooks
- **`app.js composeSystemPrompt`** (app.js:63–79) — append `DossierStore.composeBlock()` to the
  composed prompt (after identity, before manual). This is the "every agent knows you" payoff.
- **`app.js enterGame()`** — `DossierStore.init(...)` next to `ProfileStore.init`.
- **`app.js persist()` / `resumeInto()`** — add/restore `dossier: DossierStore.serialize()`.
- **`save.js`** — `CURRENT = 5`; v4→v5 seeds a valid empty dossier (cold-start-safe).
- **`stationui.js`** — a **COMMANDER** dossier panel (extend the MEMORY-tab machinery): dimensions
  with their beliefs, provenance, trust, inline edit / two-step forget; reuse `.mc-*` styling.
- **`index.html`** — include `dossier.js` + `dossierstore.js` after `profilestore.js`.

### `test/dossier.test.js` (registered in `test:fast`)
`aggregate` projection from a known profile+docs+memories fixture; `composeBlock` cap + "unknown"
omission + determinism (inject two `now`s); `upsert`/`forget` first-match-only + collision-proof
ids; `summary` familiarity math; round-trip `fresh→upsert→serialize→reload`; `learningEnabled`
gating; byte-identical block on identical input (cache-warmth invariant).

### Build logistics
Per the multi-agent protocol (CLAUDE.md): build on a fresh worktree `agent/dossier`
(`gen-trees\new-agent-tree.ps1 dossier`), not the integration tree. Phase A touches only
frontend + save + tests (no `shared/` contract change), so it merges green with no contract
coordination. Preview-verify the panel + prompt composition before merge.

---

## 11. Contract coordination (for Phase C, not Phase A)

A true station-wide durable belief needs `scope:'user'` (cross-agent, above `'global'`/`'stream'`)
in the Cortex record. `scope` lives in the contract owned by `cortex-memory` (`shared/schema.js`)
and is **additive-only for others** — so Phase C must *request* the new scope value from that
owner, not self-edit. Phase A deliberately avoids the dependency by keeping the dossier a
station-local object that *reads* existing per-agent `kind:'profile'` records into the view.

---

## 12. Risks & mitigations

- **"Creepy" / overreach (privacy-sensitive audience).** → only-observable rule; durable facts
  only through Keep/Edit/Discard; local-first proof + the glass-box panel; interview is optional
  and skippable; no source research in this design.
- **Acquisition nag.** → hard per-session budget on curiosity questions; interview is one-time +
  skippable; everything pauses with the existing learning switch.
- **Cross-agent scope is a contract change.** → Phase A ships station-wide *behavior* with a local
  store and zero contract change; the durable cross-agent belief layer is isolated to Phase C
  behind an additive request.
- **Stale dossier.** → EWMA decay on derived signal; durable beliefs carry trust + are
  editable/forgettable; the panel always shows provenance so a wrong belief reads as "edit me," not
  "the agent is wrong about me."
- **Prompt bloat / cache thrash.** → `composeBlock` is capped, deterministic, and frozen per run
  (Cortex living-core discipline) so the cached prefix stays warm.
- **Scope-creep vs. core agent value.** → smallest-first; Phase A is ~3 files of new code on
  proven seams; each phase independently shippable.

---

## 13. Open decisions (Commander's call)

1. **Interview timing (Phase B):** woven into the awakening ceremony, or a separate optional beat
   *after* the first real task (so the first thing the agent does is work, not interview)?
   *Recommendation: after the first task — protects the narratively-locked awakening and lets the
   interview reference real behavior.*
2. **Dimension set:** the five in §5 (identity/stack/goals/style/standing_orders) — add/cut any
   before Phase A freezes the schema? (Adding later is an additive migration, so this is low-risk.)
3. **Familiarity meter math (Phase D):** fraction-of-dimensions-known (simple, honest) vs. a
   weighted blend with the affinity sample count. *Recommendation: fraction-of-dimensions-known —
   legible and obviously honest.*
