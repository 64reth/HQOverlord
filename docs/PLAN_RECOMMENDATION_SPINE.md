# PLAN — Recommendation Spine (one voice for every proactive offer)

**Approved by Andrew 2026-08-03.** Lane: `agent/rec-spine`.
Vision: StarNet's differentiator is its recommendation system. Today ~7+ engines each talk to
the user through their own card/beat on their own timer. This lane consolidates them behind
ONE arbiter with ONE relevance bar and ONE gorgeous card grammar — deleting user-facing
complexity, rebuilding nothing. Every engine survives byte-identical as a *source*.

## Product contract (what Andrew signed off on)

1. **One voice.** One suggestion at a time, best-first, or silence. The user experiences
   "the station has one opinion," never competing subsystems.
2. **Evidence or silence.** A suggestion may only surface if it can cite WHY in the user's
   own words ("because you said invoices eat your Sundays" / "because the last 3 runs hit
   this wall"). No citable evidence → the candidate is dropped. This is truthful telemetry
   applied to recommendations.
3. **Zero new user-facing concepts.** No new panels, no new windows, no settings. Power-user
   menus untouched. This lane strictly *removes* perceived complexity.
4. **Gorgeous, uniform card grammar.** Every offer card reads the same way:
   *noticed (evidence, user's words) → proposal → one-tap yes/no*. Matte, CRT-native,
   eerie-not-cute. (Andrew explicitly requested beautiful cards — this is the named friction
   that licenses touching COMMS card styling: seven inconsistent shapes today.)
5. **Feedback loop preserved.** Accept/decline/outcome keep flowing into the existing
   understanding/probe machinery so relevance compounds.

## Ground truth (verified 2026-08-03 by full-repo sweep — grep before distrusting)

- Real arbiter: `frontend/app/beatcard.js` — `DEFAULT_PRIORITY = ['memory','study','arc',
  'trust','thread','rate','nudge']` (`:15`), slot machinery `makeSlot()` (`:17-86`), lifecycle
  `create()` (`:88-248`). `Study.makeBeatSlot()` (`study.js:336-340`) is a shim; the doc block
  at `study.js:303-335` describes a dead 4-kind design (stale — rewrite it).
- **Priority is inert.** Only the memory lane calls `reserve()` (`chat.js:3012`). Everything
  else relies on arm delays: nudge/rate ~650ms, study 12s, arc 14s, trust 16s, thread 18s
  (`chat.js:3404,3570,3664,3774,4232`). So the LOWEST-priority kind usually wins by being
  early. Arm delays are the de-facto arbiter; there is also a third arbiter, the if/return
  ladder in `wireCuriosity()` (`chat.js:4196-4231`).
- **Bug:** `beatcard.js:215` — `scheduleExpire(kind)` only clears a record of its own kind; an
  unanswered nudge holds the slot until `reset()`, starving study/arc/trust/thread.
- Five separate `agent.run.end` listeners drive offers: `wireStudy :3546`, `wireArc :3642`,
  `wireTrust :3750`, `wireThreads :3895`, `wireCuriosity :4163`.
- Near-duplicate guard sets: `studyBlocked()` `chat.js:3425-3431`, arc gates `:3571-3576`,
  `skillBeatBusy()` `:4046-4059`.
- Every channel already splits into a sync side-effect-free predicate + an async fire:
  study `StudyStore.canShow()/nextLive()` → `offerStudy`; arc `GoalStore.willOfferDecomposition()`
  → `offerArc`; trust `TrustStore.canShow()/currentOffer()` → `offerTrust`; thread
  `ThreadStore.canShow()` → `offerThread`; suggest `SuggestStore.willSuggest()` → `fire()`;
  seed `SeedStore.willPropose()` → `propose()`; routine `RoutineNudgeStore.willPropose()` →
  `propose()`; recruit `RecruiterStore.topPick()` → `maybeRecruit()`; curiosity
  `CuriosityStore.earned()/consider()` → `curiosityNudge(dim)`; rate `maybeStandaloneRate()`.
- Ranking substrate already exists: `UnderstandingStore.read()` → per-dim `conf`, `weight`,
  `gap` (= weight × (1−conf), `understanding.js:135-138`), `overall`, `readiness()`,
  `probeTarget()`. `CuriosityStore.voiOrder()` (`curiositystore.js:55-66`) is the prototype
  scorer — generalize it, don't duplicate it.
- Card DOM family (uniform across study/trust/thread/rate): `.cmsg.agent.tool.turnin.<kind>`
  → `.turnin-title`, `.turnin-item`, `.turnin-kind/.turnin-text/.turnin-evidence`,
  `.consent-btns/.consent-btn[.deny]`, `.consent-result`. CSS `frontend/css/app.css:688-766,
  889-903`. Gentle asides: `.cmsg.agent.nudge` + `.choice-row`. `vanish()` `chat.js:361-371`.
- `shared/events.js` defines NO study/goal/suggest/recommend events and `shared/emitter.js`
  drops unknown events silently — **do not add events; stay on the existing
  store-call + fetch transport.** `shared/events.js`/`shared/schema.js` are OWNED — do not touch.
- Not in scope for consolidation (leave alone): permission asks, low-credit/budget warnings,
  connector approvals, broadcasts, skill asides (informational, never claims slot), First
  Pitch via Dialogue, onboarding beats, channel-side autonotify.

## Build (slices, in order — verify + commit each before the next)

### S1 — `frontend/app/recommend.js` (new, pure) + tests
Pure arbiter/scorer, no DOM, no fetch:
- `Recommend.score(candidate, uRead)` → number. Inputs: candidate `{kind, why, dim?, base?}`
  + `UnderstandingStore.read()` output. Blend: per-kind base priority (derived from the
  existing DEFAULT_PRIORITY order) + VOI term for dim-targeted kinds (reuse the
  `weight × (1−conf)` gap) + small recency/streak hooks. Deterministic, unit-testable.
- `Recommend.pick(candidates, uRead)` → best candidate or null. **Drops any candidate whose
  `why` is missing/empty** (evidence-or-silence law).
- `Recommend.whyLine(candidate)` → normalized "because …" display string.
New `frontend/tests/recommend.test.js` (node:test, match neighboring test style).

### S2 — make the slot honest (beatcard.js, additive)
- `submit()/collect` registry OR reserve-at-collection: at the single collection pass (S3),
  every predicate-true channel reserves its kind so the EXISTING `can()` priority logic
  becomes live. Do not rewrite the lifecycle.
- Fix the expire bug: an expiring record clears itself regardless of kind mismatch
  (`beatcard.js:215` area) so a stuck nudge can't starve the queue.
- Extend `beatcard.test.js` (if present; else add coverage in recommend.test.js).

### S3 — one collection pass (chat.js)
- Collapse the five `agent.run.end` offer listeners + the `wireCuriosity` ladder into ONE
  listener with ONE arm point: gather candidates via the sync predicates, score with
  `Recommend.pick()`, reserve, then invoke that channel's existing fire function.
- Unify the near-duplicate guards into one `momentBlocked()` used by the pass.
- Arm delays collapse to a single short arm (rate/memory keep their special early slots —
  memory stays top priority via its existing reserve; rate keeps its post-run beat rule).
- PRESERVE every per-channel session cap/denylist/dedup — they are the second floor.
- Do not break: COMMS beat rules (decided cards vanish, ONE post-run beat), stream-switch
  `reset()` (`chat.js:963`), tutorial/onboarding stand-downs, Dialogue stand-downs.
- ⚠ chat.js and study.js have WINDOWED source-lock tests (e.g. study.test char windows after
  'function rateWork') — run `npm run test:fast` after every slice; adjust test windows only
  when the test's intent is preserved.

### S4 — the card grammar (gorgeous, uniform)
- One shared renderer (`recCard()` in chat.js or small new module) producing the uniform
  shape: **eyebrow "◈ NOTICED" + evidence line in the user's words → proposal line →
  consent buttons**. Migrate study/trust/thread/suggest/seed/routine/curiosity/recruit
  presentation onto it (each keeps its own accept/decline handlers).
- Style: extend the existing `.turnin` family in `frontend/css/app.css` — matte, no gloss,
  no white controls, VT323-aware (symbol glyphs are fallback font — box-centre, never
  padding-from-font-size), dark-only. Subtle entrance (reuse/mirror `.beat-vanish` timing).
  It must feel premium CRT hardware, not a web toast.
- FOR YOU stays where it is; align its why-strings (`forYouReason`, `recipes.js:725-739`)
  to the same "because …" grammar so COMMS and the shelf speak identically.

### S5 — docs + stale-comment hygiene
- Rewrite the dead arbiter doc block `study.js:303-335` to point at recommend.js/beatcard.js.
- Update `docs/BRAIN.md` subsystem note if it names the beat chain.

## Verification (before claiming done — starnet-verify applies)
- `npm run test:fast` fully green (read the LOG, not the exit code).
- Live: fresh port + own `SKYNET_WORKSPACES`, real boot, drive a run to the post-run beat and
  observe: exactly one card, correct winner by priority (not by arm-delay race), evidence
  line rendered, accept + decline both settle and vanish, next-best does NOT immediately pile
  on, stream switch resets cleanly, stuck-card expiry frees the slot.
- `frontend/` edits owe a claims re-lock (code first, regenerate, lock alone) + website
  mirror is generated (`npm run sync:website` runs in gate — fails LATE).

## Risks / traps (from memory + map)
- Over-quieting: if the arbiter is too strict the station feels dead. Keep the gentle-aside
  informational lane (skill asides, broadcasts) OUT of the queue.
- `voice.button.test` is flaky — re-run before believing a red.
- Gate exit 3221225773 = RAM starvation, not your change.
- No `Date.now`/`Math.random` in backend logic (lint-determinism); frontend chat.js already
  uses them — match local idiom.
- Commits: human author only, NO Co-Authored-By trailers. Pathspec adds only.
