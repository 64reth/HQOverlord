# UX Fix Plan — 2026-07-04

Execution plan for [docs/UX_CONFUSION_AUDIT_2026-07-04.md](UX_CONFUSION_AUDIT_2026-07-04.md).
Written as marching orders for parallel implementation lanes (Opus agents in worktrees,
orchestrator merge-gates per `starnet-merge-ritual`). Read the audit first; this doc only
says WHO builds WHAT in WHICH order.

## Operating principles for every lane

1. **Fix themes, not symptoms.** Where a shared primitive exists (2-step confirm, friendlyerror
   `action` field, budget `scopes{}`), extend it — never fork a parallel mechanism.
2. **Grep trunk before building each item.** The audit's line numbers were true on 2026-07-04
   and will drift. If an item already shipped in another lane, skip it and say so.
3. **Truthful telemetry is the tiebreak.** Every new state line must be provable from harness
   state ("paused — waiting for approval" only renders when the run IS paused on approval).
   No aspirational copy.
4. **Sandbox law.** Nothing in this plan adds gating, grind, or permission walls. All fixes are
   explanation, routing, and honesty — power stays full from minute one.
5. **Done = observed live** (starnet-verify): DOM round-trip in the running app + green
   `npm run test:fast`. Copy changes still need a live render check (esc/HTML injection,
   layout overflow — see the turnin-grid lesson).
6. **Commit pathspecs only; stay in your worktree; never touch `shared/events.js`/`shared/schema.js`.**

## Conflict map — file ownership (the reason lanes are shaped this way)

The audit's fixes cluster onto four hotfiles. To avoid last-write-wins merges, each hotfile
gets exactly ONE owning lane per wave; everyone else keeps their hands off it:

| Hotfile | Wave-1 owner | Wave-2 owner |
|---|---|---|
| `frontend/app/chat.js` | Lane B (run-truth & outputs) | Lane G (loop comprehension) |
| `frontend/app/stationui.js` | Lane C (settings & diagnostics) | Lane H (budget/models/voice) |
| `frontend/app/marketplace.js` | Lane D (recruitment) | — |
| `frontend/app/app.js` + onboarding/tutorial/keycta | Lane E (first-run) | — |
| `frontend/app/friendlyerror.js`, `modelpicker.js` | Lane A (error doors) | — |
| `frontend/app/autojobs.js`, `workshopstore.js`, `returnstore.js` | Lane F (routines/away honesty) | — |

Cross-file exceptions are called out per lane and must be single, small, coordinated commits.

---

## Wave 0 — decisions & primitives (before lanes launch)

### 0.1 Asks for Andrew (blocking only where marked)

- **Support email address** (BLOCKS A-4). One constant swap in `diagnostics.js:24`. Everything
  else in the plan proceeds without it.
- **Terminology ruling (non-blocking, default provided):** the plan renames user-facing
  "OWN PC" → "its own desk" and explains (not renames) "workstream", "REFIT", "CLEARANCE".
  Internal keys/schemas untouched (same rule as the StarNet rebrand). Object if wrong.

### 0.2 Shared primitive: hint/glossary helper (lane P, tiny, merges FIRST)

One new module `frontend/app/hint.js` + a term map `frontend/app/glossary.js`:

- `Hint.attach(el, term)` / `data-hint="workstream"` → hover/tap tooltip, VT323-free (HTML UI
  layer, not canvas), themed via existing CSS vars (never literal amber — use `--gold-rgb`
  family per frontend law).
- Glossary entries are ONE sentence each, written for a beginner:
  `workstream: "this agent's own chat thread — switch streams to talk to different agents"`,
  `refit: "the station's build mode — open it from the dock to place furniture and gear"`, etc.
  Seed it with the audit's Theme-1 table.
- **Done means:** hover any `data-hint` element in the live app → tooltip renders with the
  right copy; zero tooltips on canvas hover paths (hover=glance law untouched).
- This merges before Waves 1–2 so every lane can sprinkle `data-hint` on its own screens
  instead of inventing local tooltip code.

Also in Wave 0: extract the existing 2-step arm/confirm pattern (key removal,
stationui.js:~1990) into a small helper if it isn't one already, so Lanes B/D reuse it.

---

## Wave 1 — P0: trust breakers & dead-ends (6 lanes in parallel)

### Lane A — `ux-error-doors` (friendlyerror.js, modelpicker.js, diagnostics.js)

Every error names its door and opens it.

1. **capdenied v2:** parse the capability from the raw error (the classifier at
   friendlyerror.js:85 already sees it), render "needs FILE ACCESS (the CABINET)" + an action
   button. Route to the true unlock: gear/REFIT (or the station quest if one was minted —
   stationqueststore already mints on capdenied), NOT the SKILLS list.
2. **auth/no-key v2:** action button that opens the actual key entry (CONNECT key field /
   PROVIDERS card), not generic Settings. Codex users get "sign in with ChatGPT" instead.
3. **modelpicker stranded state:** "no models found" gets the same button. modelpicker.js:81.
4. **Support email:** swap `ANDREW_SUPPORT_EMAIL` once Andrew supplies it; also render the
   diagnostics block on-screen in a `<pre>` after copy (clipboard-failure fallback).
5. **Stop-reason copy:** "max_iters" → "step limit" wording (the STRING map lives in chat.js —
   hand the one-line change to Lane B as a requested edit, don't touch chat.js yourself).

**Done means:** trigger a capdenied live (ask for a web task with no DISH) → error row names
the capability and its button opens REFIT/quest; kill the key and send a task → button lands
focus on the key input. test:fast green.

### Lane B — `ux-run-truth` (SOLE chat.js owner, wave 1)

Sequential slices inside one worktree, committed one at a time:

1. **Approval pause state:** when status is AWAITING APPROVAL, restyle the presence card
   (distinct color, no "working" pulse) and name the pending action: "paused — waiting for you
   to approve fs.write". Truth source: the approval prompt already rendered at chat.js:958.
2. **Beat-queue indicator:** when `turninQueue`/pending beats are nonempty, render one dim
   line "1 more follow-up after this…" — kills the 2-second "hang".
3. **Deliverables → disk:** every "▤ saved <file>" line and the recap card get
   "📁 open folder" (Tauri: shell open on the workspace dir; browser: show the path with a
   copy button). Workspace path comes from the run's agent id (`workspaces/<agentId>/`).
4. **Return card v2:** verification block lists the commands run and their pass/fail;
   "built, not yet tested" becomes "built — no test commands were defined" when that's the
   truth (manifest distinguishes these). Keep-path gets a folder picker on desktop (Tauri
   dialog), path-typing stays as browser fallback with inline validation.
5. **Quest dismiss confirm:** 2-step arm ("Dismiss forever — sure?") using the Wave-0 helper.
   (Logic lives in the quest card render inside chat.js/workquests.js — workquests.js is
   Lane B's too.)
6. **Crash honesty:** on sidecar reconnect after a dropped stream, one line: "connection
   restored — your last run was interrupted and can't resume; start it again."
7. Lane A's requested one-liner (stop-reason strings).

**Done means (per slice, live):** approve-gated run shows the paused card; a file-writing run
shows a working open-folder affordance; a workshop return card shows named commands; quest
dismiss takes two clicks. Canvas untouched.

### Lane C — `ux-settings-truth` (SOLE stationui.js owner, wave 1)

1. **Key-save confirmation:** after SAVE, inline "✓ key saved — stored in your OS keychain"
   (desktop) / "stored locally in this browser" (browser). Truth source: keychainMode from
   the sidecar, already exposed.
2. **Inline key entry on provider cards:** "○ NO KEY" cards get a collapsible paste-and-save
   row (reuse the existing keysHtml wiring — don't duplicate the save path).
3. **Env-var override indicator:** when a budget/advanced field is being overridden by env,
   badge the field itself ("set by environment — this value is ignored"). The sidecar knows;
   expose it in the same status payloads if a field is missing (additive route change only —
   if it needs a shared/ event, request from the contract owner instead).
4. **Diagnostics copy target:** consume Lane A's constant (no logic here, just render).

**Done means:** save a key live → confirmation names the real store; provider card enters a
key end-to-end; an env-pinned cap renders its badge.

### Lane D — `ux-recruit-doors` (SOLE marketplace.js owner, wave 1)

1. **Prospect dismiss confirm:** 2-step arm + copy that admits permanence ("dismiss forever —
   the station won't draft this role again").
2. **Model-picker stranded state** in the summon flow: consume Lane A's action-button pattern
   (coordinate: Lane A owns modelpicker.js; Lane D only wires the container).
3. **Dossier de-jargon (copy-only):** CLEARANCE/EFFORT/FOCUS/GEAR rows get `data-hint` terms;
   "not on station — add in REFIT" gains "(optional — you can still summon)". No layout changes.
4. **Kit checkboxes in the custom builder** show their capability blurbs (the `capGrant` map
   already has them) + inline "pick at least one kit item" validation on save.

**Done means:** live bay walk — dismiss takes two clicks; builder save with empty kit explains
itself; hints render on dossier rows.

### Lane E — `ux-first-run` (app.js + onboarding.js + tutorial.js + keycta.js)

1. **Persist `onboarded` at ceremony finish** (not after enterGame) so refresh mid-ceremony
   resumes sanely; verify the resume path doesn't skip the ceremony for genuinely new agents.
2. **Awakening fallback honesty:** when `birthFailed`, mark the moment honestly in the agent's
   own voice ("(my live mind didn't answer — these words are from my boot script)") — smallest
   change that satisfies the telemetry law without wrecking the ceremony.
3. **Diegetic no-key state:** replace/augment the KeyCTA banner with the agent speaking it in
   COMMS ("i'm awake but have no brain wired — add a key and i can work"), button → CONNECT
   key field (Lane A's routing target).
4. **Post-summon follow-up:** replace the REFIT sentence (app.js:605) with an actionable
   notification: "<name> needs a desk to take floor work → [PLACE ITS DESK]" that opens REFIT
   with desk placement armed (the tutorial's requisition fast-path shows the mechanism).
   Copy says "desk", never "OWN PC".
5. **Skip-tutorial honesty:** the first-command demo's capdenied path explains the causal
   link ("we skipped placing my file cabinet — place it and i'll retry") with a place-it button.
6. **Key overwrite guard on resume:** typing over a pre-filled key asks once before replacing.

**Done means:** fresh-wake live walk (dev seed): refresh mid-ceremony resumes; no-key state
speaks in the agent's voice; summon → one tap places a desk; skip-then-demo explains itself.

### Lane F — `ux-away-honesty` (autojobs.js, workshopstore.js, returnstore.js, cron surface)

1. **Routines-disarmed banner:** anywhere a routine is created or listed while
   initiative='wait': "saved, but routines are disarmed — enable Autonomy (SETTINGS → AUTONOMY)
   to let this run." Truth source: AutonomyStore.
2. **`/build-away` truth:** queue confirmation states the condition ("builds run while the app
   is CLOSED — quit when you're done and i'll get to work"); queuing with the grant off gets a
   visible error + a button to the grant toggle (chat.js render line is Lane B's — hand off the
   one-line string change).
3. **Away digest fairness:** per-row dismiss; dismissing the digest points at the OUTBOX
   ("the crate on the floor holds these until you review them").
4. **Cadence honesty:** "every morning" → "every morning · 9:00 (your local time)" — cron.js
   already accepts tz; surface the resolved time.

**Done means:** schedule a routine with autonomy off → banner renders; `/build-away` with the
grant off errors visibly; digest rows dismiss individually. Mock-cron seed
(`cron-sessions-proof` launch config) exercises the digest without real scheduling.

### Wave-1 merge order

P (hint helper) → A → C → F → D → E → B last (largest chat.js surface rebases onto everything
else). Full `starnet-merge-ritual` per branch; grep-symbols check after B (chat.js hotfile
rule from the Codex-coexistence lesson).

---

## Wave 2 — P1: comprehension (after Wave 1 merges)

### Lane G — `ux-loop-legibility` (chat.js owner, wave 2)

- Slash discoverability: placeholder → "speak to your agent — or type / for commands"; add
  `/help` listing commands with one-line whens.
- Rating explainer (one-time hint on first rate card: "👍 teaches it and grants XP; 👌/👎 are
  feedback") + pending-ratings count on the rail.
- Presence card verbs: tool id → human verb map ("web.search" → "searching the web…"),
  stronger working animation within motion.css tokens.
- Interview progress ("2 of 5") + closing beat ("that's everything — talk normally now").

### Lane H — `ux-settings-depth` (stationui.js owner, wave 2)

- Budget spend bars per scope from `/api/budget/status` (`scopes{usd,cap,frac}` already
  computed; warn color at 80% matches backend `warn`).
- Human model labels + tier badges: ONE map consumed by dock, picker, fallback chain, dossier
  (coordinate the map's home with Lane D's dossier usage — put it in modeldock or a new
  `modellabels.js` so it's import-order safe).
- Unified VOICE section (speaker toggle + per-persona style/speed editors already in
  personas.js; this is re-homing UI, not new engine).
- Import "secretsNeeded" re-entry checklist after config import.
- Disabled effort buttons get "not supported by this model" titles.

### Lane I — `ux-topology` (new surfaces, low collision)

- One-time "how it fits together" card (Skills = what it CAN do · Recipes = ready-made jobs ·
  Routines = jobs on a schedule · Autonomy = how far it goes alone), shown once, dismiss
  persists. Follows the one-beat rule (COMMS gold-inset family, never `.reply`).
- "Because you said: …" grounding lines on pitches, standing-job proposals, and the recruiter
  shelf (the engines already store the grounding — render it).
- Locked skills: each gear badge links to its unlock path; copy reframed from "currently off"
  to "unlocks when the <gear> is on station — place it in REFIT".
- Belief provenance badges in the dossier ("you told me" / "observed from your work").

### Lane J — `ux-lifecycle` (updates.js, updatecore.js, INSTALL.md)

- Define "critical" in the update card; full release notes link; pre-restart warning when a
  run is in flight; retry affordance on failed installs.
- INSTALL.md: side-by-side SmartScreen-vs-SAC walkthrough with screenshots (docs-only, can
  start any time).
- Routine execution log (last run / next run / produced-what) — coordinate with Lane F's
  surfaces; may consume the cron-sessions work already on trunk (grep first — memory says
  cron runs already surface as sessions; this may be mostly linking, not building).

---

## Wave 3 — P2 polish (backlog, schedule opportunistically)

Autonomy posture impact preview + earned-trust explanation; theme previews; catalog-refresh
button + unknown-model flags in the fallback chain; per-scope budget overrides persistence
note; hero-vs-crew mode indicator; recently-summoned shelf; OUTBOX click → run content view
before rating. None of these block release.

## What we are explicitly NOT doing

- No renaming of internal keys, events, or schemas (rebrand rule).
- No new gating/unlock mechanics — every "unlock" line describes existing gear truth.
- No canvas hover tooltips (hover = nameplate glance, locked).
- No second model-labels source of truth — one map.
- No auto-rating or forced beats — beats stay optional and one-at-a-time.

## Release gate

Wave 1 complete = the audit's P0 list closed. Before calling it done: one attended end-to-end
beginner run on a FRESH profile (wake → key → tutorial → first task → find the file → summon →
desk → /build-away → close → reopen → return card → keep to a folder), performed in the
desktop build, screenshots into docs/. That single walkthrough exercises every Wave-1 lane and
is the honest ship check.
