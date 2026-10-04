# Personalization & the Living Profile — design

**Status:** Phase 0 building on `agent/personalization`. Phases 1–3 specced here, not yet built.
**Origin:** an 8-agent design panel (ground + 7 lenses, adversarially red-teamed) over the actual codebase, 2026-06-17.

---

## 1. The vision, reframed

The Commander's idea: *the harness researches and gets to know the user over time, then recommends recipes and marketplace agents tailored to that user — a curated feed that sharpens the longer you use it.*

The panel validated the instinct and sharpened it with two reframes that the moat + skeptic lenses both landed on:

1. **Drop "feed," keep "knows you."** A *feed* implies infinite scroll + engagement-maximizing surfacing — the wrong metaphor for an ops tool, and it needs dense data a single local user can't produce. The same signal powers something better and honest: an **explainable "Recommended for you — *because you…*" re-sort** of the catalogs, plus an optional once-a-day **Station Briefing**. Same magic ("it gets me"), none of the attention-economy downside.
2. **The moat is not the recommendations — it's the compounding *owned asset*.** "An AI that learns you" is table-stakes (ChatGPT/Claude memory already do it, with more data). What they structurally **cannot** copy: this is **local-first** (the profile never leaves the user's machine — they own it) and it compounds into **a growing library of agents, custom specialties, and recipes shaped to exactly how this user works**. That library is the switching cost.

**Positioning sentence:** *The local-first harness that quietly learns how you work and compounds it into a library of agents you own — and it shows its work.*

---

## 2. Principles (non-negotiable)

- **Local-first, provably.** The profile lives in `localStorage` (`starnet.save`) / per-agent JSON. No central server. The trust promise is architectural, not policy: *"your profile, 0 bytes sent."*
- **Glass box.** One screen shows everything the harness has learned, each row with its provenance; the user can edit, forget, pause, and export. Cloud assistants can't match this.
- **Every recommendation explains itself.** A deterministic "because you…" line on every card, sourced from the signal that actually dominated the score — never an LLM guess, always present.
- **Honest about confidence.** Cold-start says so ("calibrating"), exactly like the existing Confidence% meter. Never fabricate a number the data hasn't earned.
- **Explore, never trap.** Reserve an exploration slot and decay affinity (EWMA) so the catalog can still surface specialists the user would grow into. The full catalog is **never hidden** — recommendations re-order, they don't filter.
- **Consent-shaped, not consent-fatiguing.** Passive *derived counts* (a tag histogram — never raw prompt text) compute silently, same justification as the existing agent notebook. Any *durable stated fact about the user* ("prefers Rust") rides the locked Keep/Edit/Discard memory-formation flow.

---

## 3. The data substrate — what we already have (grounded)

The panel's code read found the substrate is ~70% there and **the single best signal is being thrown away**:

| Signal | Source | Where | Persistence |
|---|---|---|---|
| **Interest tag `{code\|research\|general}` per message** | every user message | `classify.js getTag()`, computed at `chat.js:195` | **EPHEMERAL — computed then discarded every frame. The highest-leverage capture in the app.** |
| Conversation history per task-thread | Workstream | `workstreams.js` history[] → `save.js` | durable (localStorage) |
| Titles, lanes, per-stream cost, **deliverables** (shipped = strong outcome signal) | Workstream | `workstreams.js` appendRun/recordDeliverable/setLane | durable |
| Deployed **specialty** per agent + saved customs | Recruitment Bay | `agent.specialtyId`; `specialties.js` custom store | durable |
| The awakening **context.md** + chosen purpose/persona | onboarding | `onboarding.js`, `agent.docs.context` | durable (free-text blob) |
| XP / level / confidence + counters | reduction over `U.bus` | `xp.js`/`xpstore.js` → `agent.stats` | durable |
| Agent memory notes (Cortex) | notebook tool | `sidecar/.../notebook.js`; `memory.*` events | durable per-agent JSON |

**Seams to build on:**
- **`U.bus` event spine** (`harness.js` re-emits every sidecar event) — a read-only consumer is the pattern; **`xpstore.js` is the exact precedent** (subscribes read-only, folds into a persisted derived object, never emits).
- **`save.js` migration ladder** (`CURRENT=3`, forward-only) — a `profile` slice is a v3→v4 migration mirroring the v2→v3 XP literal.
- **`specialties.js` / `marketplace.js`** — the catalog to rank; `marketplace.js gridHTML()` is the render surface for a "Recommended for you" section.
- **Cortex `kind:'profile'`** — the durable human-readable dossier is *already specced* (`docs/MEMORY_AND_CONTEXT_PLAN.md §5.2`) and the `memory.*` events are already frozen, so a profile fact rides additively with **no contract change**.

**Gaps (what we must add):** no ProfileStore / aggregation; the classify tag is discarded; **no recipe catalog exists in code at all** (so "recommend recipes" has nothing to rank until Phase 2 ships it); no ranking layer; no structured profile schema; no impression/accept funnel.

**Contract discipline:** `shared/events.js` / `shared/schema.js` are owned by the cortex-memory workstream and are additive-only for others. **ProfileStore must NOT emit a bus event** — it consumes read-only and acts via direct calls, exactly like `xpstore.js`.

---

## 4. The user model (two layers)

**Layer A — the affinity vector (the recommender's fuel).** A small per-tag histogram with EWMA recency decay + a sample count. Derived counts only (never raw text), so it computes silently. This is what ranking reads.

**Layer B — the dossier (the moat, human-readable).** Durable stated facts about the user ("mostly TypeScript", "ships at night"), each with provenance + trust, living as Cortex `kind:'profile'` records. Written only through the Keep/Edit/Discard gate. This is the part the user reads, edits, and that makes the agent feel like it knows them.

**Signal weighting:** an *asked-for* topic is weak; a *shipped deliverable* in that topic is strong. Outcome events (`workitem.delivered`, the `shipped` lane) fold at a higher weight than raw message tags. Contradictions are never hard-deleted — EWMA decays a stale declaration as fresh behavior accrues.

---

## 5. The recommender

- **Content-based, single-user.** Collaborative filtering ("users like you") is impossible — N=1, local, no server. Instead: tag each catalog item with the same vocabulary, and rank by **affinity × recency × explore** as a **pure, deterministic, unit-testable `score(item, profile, now)`**. No model call is needed to show a recommendation.
- **One feed, heterogeneous items.** Built to rank an `Item[]` (specialties now; recipes slot in at Phase 2).
- **The because-line is a byproduct of the score** (the top contributing term), so it's always present and always honest.
- **Explore/exploit:** a reserved wildcard slot + EWMA decay so the feed can't ossify on one tag.
- **LLM-as-curator is optional + opt-in (Phase 3):** a "✨ Curate" button that spends the user's own tokens to propose 3 picks with reasons, validated against the real catalog. Never the default path.

---

## 6. Privacy & trust (the glass box)

- **`learningEnabled` flag** — a single boolean the store checks before folding anything (a local do-not-track). Pause = stop folding; the existing data stays until forgotten.
- **"Everything I've learned about you" panel** — renders the whole profile slice verbatim, each row with provenance (which signal, when, how many samples), with inline **edit / forget / export / wipe**.
- **Because-line on every recommendation.**
- **Consent beat at onboarding** — one optional line: *"STARNET can learn what you work on (locally, never sent anywhere) to tailor your suggestions. [Enable] [Not now]"* → sets `learningEnabled`.
- **Anti-overreach rules:** only reflect back what's observable (never "I noticed you're job-hunting"); durable facts go through Keep/Edit/Discard; never quote raw history back in a recommendation.

---

## 7. The surfaces (UX) — three, ranked by how earned the attention is

1. **PULL — "Recommended for you" shelf** pinned above `▮ CATALOG` in the Recruitment Bay (and the future Recipe library). The user opened the bay to browse, so a re-rank is pure value, zero interruption. Each card: ITEM (reuse `cardHTML`) + WHY + one-tap act. **Ship this first.**
2. **SCHEDULED — "Station Briefing"** terminal (a 7th `BUILDERS` entry + a once-per-day dot like `#nf-badge`): a short daily standup the station gives its Commander. Suppressed entirely when confidence is low or nothing changed ("all quiet" beats inventing news).
3. **PUSH — at most one COMMS suggestion pill** (reuse `Chat.choices`), hard-gated: only when idle + just-shipped/session-open, max one per session.

**Gamified framing:** the station is *getting to know its Commander* — surface a "STATION FAMILIARITY — calibrating… → 28% → sharpening" meter reusing the honest Confidence% pattern. Anti-spam is a hard budget, not a vibe.

---

## 8. The moat move (the owned, compounding asset)

The histogram isn't the moat — what it lets the user *produce* is. As the profile sharpens, the harness **auto-mints user-tuned recipes and custom specialties** from observed patterns ("you keep asking for morning research briefs → saved as a recipe"), building a growing **library the user owns and can export/carry**. That accreting, portable, local asset — not the re-sort — is the defensible thing. Portability (export/import) is what turns local storage from *hostile* lock-in into *value* lock-in.

---

## 9. Phase plan

| Phase | Scope | New/seam |
|---|---|---|
| **0 (this branch)** | The substrate: stop discarding the signal. Pure `profile.js` engine + `profilestore.js` wiring + capture the classify tag + seed from onboarding/specialty + save v4 slice + tests. **No UI yet.** | `profile.js`, `profilestore.js`, `save.js` v4, `chat.js`/`onboarding.js`/`app.js` hooks, `index.html`, `test/profile.test.js` |
| **1** | Make it visible: "Recommended for you" re-sort in the bay (with because-lines) + the glass-box "what I've learned" panel + the consent beat + the familiarity meter. | `feed`/rank surface in `marketplace.js`; a StationUI panel; onboarding consent beat; specialty `tags` |
| **2** | The Recipe/Mission library — ships with personalization native (recipes + specialists ranked in one surface). | `recipes.js` registry + library UI |
| **3** | The moat move: auto-mint user-tuned recipes/specialties + export/import + the Station Briefing + optional LLM-curator. | Cortex `kind:'profile'` dossier writes through Keep/Edit/Discard; briefing terminal |

Each phase is independently shippable and test-gated, smallest-first — the same cadence as the marketplace.

---

## 10. Phase 0 spec (building now)

Mirrors the codebase's **pure-engine / browser-wiring** split (`xp.js` / `xpstore.js`).

### `frontend/app/profile.js` — the pure engine (UMD, node-testable, clock injected)
- `fresh()` → `{ v:1, tags:{}, seed:null, enabled:true, total:0 }`
- `observe(profile, { tag, weight }, now)` → decays the tag's stored weight by elapsed time, adds `weight` (default 1), bumps `n` + `total`, stamps `t`. No-op when `!profile.enabled`. Unknown tag → `general`.
- `seed(profile, tag, now)` → sets a cold-start prior — **only on a cold profile (first seed wins)**; ignored once real data exists.
- `affinity(profile, tag, now)` → recency-decayed weight normalized 0..1 across the 3 tags, blended with the seed while cold.
- `score(profile, itemTags, now)` → `Σ itemTags[t] · affinity(t)` — the ranking primitive.
- `summary(profile, now)` → `{ affinity:{code,research,general}, dominant, samples, calibrating }` for the glass box + because-line + the calibrating gate.
- `setEnabled` / `forget` (wipe learned data, keep the flag).
- Tunables in one place: `TAGS`, `HALF_LIFE_MS` (recency half-life), `CALIBRATING_N` (min samples before "known"), `SEED_WEIGHT`.
- **No `Date.now`/`Math.random`** — `now` is always injected (testability; matches the xp engine's determinism).

### `frontend/app/profilestore.js` — the browser wiring (near-clone of `xpstore.js`)
- Read-only `U.bus` consumer, `FEED = ['workitem.delivered']` (shipped work, tagged via `getTag(title)`, folded at a higher weight). **Never emits.**
- `init({ profile, persist })` — load the saved slice or `Profile.fresh()`; wire the FEED.
- `observeMessage(text)` — the direct hook from `chat.js`: folds `Classify.getTag(text)` at weight 1 (gated on `enabled`).
- `seed(tag)` — from onboarding/specialty (guarded cold).
- `serialize()` (for persistence) · `summary()` · `score(itemTags)` · `setEnabled` / `enabled` / `forget`.

### Hooks
- **`chat.js:195`** — after the existing `Classify.isTaskDirective(text)`: `if (isTask) ProfileStore.observeMessage(text)`.
- **`onboarding.js answer()`** — on the `purpose` step, `ProfileStore.seed(Classify.getTag(commitText))`.
- **`app.js enterGame()`** — `ProfileStore.init({ profile: pendingProfile, persist })` next to `XpStore.init`; then seed from `agent.specialtyId`'s domain if present.
- **`app.js persist()`** — add `profile: ProfileStore.serialize()` to the payload.
- **`app.js resumeInto()`** — `pendingProfile = saved.profile`.
- **`save.js`** — `CURRENT = 4`; v3→v4 migration seeds an empty, valid profile (**cold-start-safe** for a user who never finished the awakening).
- **`index.html`** — include `profile.js` + `profilestore.js` (after `classify.js`, near `xp`).

### `test/profile.test.js` (registered in `test:fast`)
Affinity from observations; seed cold-start + first-seed-wins; EWMA recency decay (inject two `now`s); `score()` ranking order; `calibrating` below `CALIBRATING_N`; `forget`/`setEnabled` gating; round-trip through `fresh→observe→serialize→reload`.

---

## 11. Risks & mitigations

- **Cold-start is the permanent state (N=1, local).** → seed from the onboarding chip/specialty so day 1 isn't empty; **say "calibrating"** until samples accrue; lean on the rich built-in blurbs so the catalog is browsable regardless.
- **Filter-bubble / over-fit.** → EWMA decay + reserved explore slot + **never hide the catalog** (re-order only).
- **A confidently-wrong rec erodes trust worse than none.** → gate the "Recommended" section behind a minimum-signal threshold; every card shows its because-line so a miss reads as "it's still learning," not "it's wrong about me."
- **Privacy backlash (the audience is privacy-sensitive).** → local-first proof + glass box + the one-beat opt-in; durable facts only through Keep/Edit/Discard.
- **Scope-creep vs core agent value.** → smallest-first, each phase shippable; Phase 0 is ~3 files of new code on proven seams.
- **Recipes don't exist yet.** → Phase 0/1 rank **specialties only**; "recommend recipes" lights up at Phase 2 when the catalog exists.
- **Coarse tag vocabulary (3 buckets).** → enough to separate Engineer from Researcher now; finer domains (e.g. `rust` vs `react`) are a later enrichment of the same histogram, not a rewrite.

---

## 12. Open decisions (Commander's call)

1. **Learning default: on or opt-in?** Phase 0 ships the `enabled` flag defaulting **ON** (purely local, the user's own data, reversible + transparent via the Phase 1 glass box) — but the consent beat in Phase 1 can flip this to opt-in if preferred. *Recommendation: on-by-default-with-easy-pause for local data.*
2. **Recipe vs specialty priority for the first visible payoff** (Phase 1 vs Phase 2 ordering).
3. **How aggressive the moat move is** — auto-mint recipes silently vs propose-and-confirm (recommend: propose-and-confirm, consistent with the memory gate).
