# StarNet UX Confusion Audit — 2026-07-04

Walkthrough of every major user path, focused on where a **beginner** (the product's target
user — less technical than a reference-harness user) gets confused, stuck, or loses trust. Produced by
six parallel code-grounded audits (onboarding, recruitment, core work loop, settings/keys,
skills/recipes/autonomy, away/return/desktop). High-impact claims were re-verified against
trunk `feat/harness-backend` on 2026-07-04. Live servers were up (:8830 trunk seed) but the
findings below are grounded in code paths, with file:line references.

---

## Part 1 — Cross-cutting themes

These are the patterns that repeat across every path. Fixing a theme fixes ten screens at once.

### Theme 1: The jargon wall

The app speaks fluent StarNet at users who have been here for zero minutes. Every path is
gated by at least one unexplained term:

| Term | Where a beginner first hits it | Ref |
|---|---|---|
| "workstream" | Recruitment Bay subtitle, summon CTA | marketplace.js:252, 610 |
| "orchestrator" | model picker: "blank = same as your orchestrator" | marketplace.js:458 |
| "REFIT" / "OWN PC" | post-summon toast | app.js:605 |
| "CLEARANCE" / tier pips | class cards & dossier | marketplace.js:477, 628 |
| "lane" (CODE/RESEARCH/OPS) | roster filter bar | marketplace.js:289-295 |
| "DISH / CABINET / NOTEBOOK" | custom-class kit picker, skill gates | marketplace.js:64 |
| "seed" | away digest row ("from the seed you saved") | returnstore.js:42-47 |
| "drafted for you" | prospect shelf | marketplace.js:850 |
| "sidecar" | error states ("is the sidecar running?") | marketplace.js:1720 |
| "leash" / "reach" | autonomy internals leaking into UI | autonomy.js:39 |

**Fix direction:** a shared tooltip/glossary layer (one JS map of term → one-liner, rendered as
hover hints), plus a copy pass that renames the worst offenders in user-facing strings
("OWN PC" → "its own desk", "workstream" → "its own chat thread"). No new systems needed —
this is copy + a tiny tooltip helper.

### Theme 2: Working states look dead; dead states look fine

The single biggest trust killer. Multiple places where the system is *fine* but looks broken,
or *broken* but looks fine:

- **Approval pause looks like a crash.** "AWAITING APPROVAL" (chat.js:189) doesn't show WHAT
  is pending or that the run is paused on the user. Beginners force-stop runs that were
  waiting for them.
- **Beat queue is silent.** One-beat-at-a-time is a good law, but between beats there's a ~2s
  gap of nothing (chat.js:66, 1123). Feels like a hang.
- **Away workshop never explains "away."** Work only executes when the app is CLOSED and the
  30s heartbeat lapses (returnstore.js:13-24, workshopstore.js:29). A user who queues
  `/build-away` and minimizes the window reopens to nothing and concludes the feature is broken.
- **Routines can be scheduled while autonomy is disarmed.** The cron job saves fine, then
  never fires, and nothing says why (autonomy initiative='wait'; autojobs.js:178 says "it's
  on the schedule"). Classic silent dead-end.
- **Sidecar crash mid-run is silent.** The Tauri watchdog respawns it (main.rs:1165) but the
  user's in-flight run just stops mid-output with no "your run was interrupted" line.
- **Awakening LLM fallback is silent.** If the live birth-script call fails, the ceremony
  plays the templated spine with no signal (onboarding.js:374-415). This one violates the
  truthful-telemetry law directly: the app presents templated words as generated ones.

**Fix direction:** every wait/pause/degrade gets one honest line of state: "paused — waiting
for your approval", "next follow-up loading…", "away builds run only while the app is closed",
"routine saved but disarmed — enable Autonomy to let it run", "connection restored — your
last run was interrupted."

### Theme 3: Errors name the problem, not the door

Error copy is honest but routes users to the wrong place or no place:

- **capdenied → "enable it in SKILLS"** (friendlyerror.js:46) is wrong twice: it doesn't say
  WHICH capability, and the real unlock is gear/REFIT, not the SKILLS list.
- **auth → "add a provider key in Settings"** (friendlyerror.js) — but key entry lives on the
  CONNECT screen / PROVIDERS cards, and the message offers no button.
- **"no models found — add a provider key in Settings"** (modelpicker.js:81) — stranded, no link.
- **"max_iters"** leaks a technical token where "step limit" was meant (chat.js:3608).

**Fix direction:** friendlyerror already classifies kinds and has an `action` field — make
every error render an action **button** that opens the exact panel (CONNECT key field, SKILLS,
REFIT), and interpolate the missing capability name into capdenied copy. The plumbing exists;
it's a copy + wiring pass.

### Theme 4: Outputs are invisible

The product's pride loop is "real work you can hold" — and then hides the work:

- File deliverables render as "▤ saved report.md" with **no path and no open-folder button**
  (chat.js:731; artifacts.js:31 deliberately shows sanitized labels). Beginners genuinely
  cannot find their files (`workspaces/<agentId>/…`, fs.js:68).
- Workshop return card's verification line ("tested — 2 of 3 commands passed", chat.js:1275)
  never says which commands or why one failed, and "built, not yet tested" reads as failure
  when it often means "no test commands defined."
- The "Keep" flow requires typing an absolute Windows path by hand (chat.js:1355) — no folder
  picker, silent failure on bad paths.

**Fix direction:** a "📁 open workspace" affordance on every file deliverable and on the recap
card; expand verification with the command list; folder-picker (Tauri dialog) for Keep.

### Theme 5: Irreversible actions without a speed bump

- **Quest dismissal = stop forever** (workquests.js:13) with no confirm. One misclick nukes a
  build plan permanently.
- **Prospect dismiss (✕) denylists the fingerprint silently** (marketplace.js:1001-1004) — no
  confirm, no undo, and the station will never draft it again.
- **"SKIP VERSION" on updates** persists forever (updates.js:225-234) and can hide a critical
  patch.
- Contrast: key removal and workshop discard already have the 2-step arm/confirm ritual
  (stationui.js:1990, chat.js:1375). The pattern exists — apply it to the other three.

### Theme 6: The system's shape is invisible

Skills enable Recipes; Recipes become Routines; Autonomy gates Routines; the Dossier feeds
Pitches and standing jobs. The topology is coherent in code and **never explained anywhere in
the app**. Each surface (SKILLS window, RECIPES tab, autonomy dial, dossier) is an island.
Beginners can operate each one and still never see the growth path
(learn → propose → build → delegate → earn trust). One one-time explainer card + cross-links
("recipes that use this skill", "this routine came from your pain point: …") would connect it.

### Theme 7: Shipped-broken trust items

- **`SUPPORT_EMAIL = 'ANDREW_SUPPORT_EMAIL'`** (diagnostics.js:24) renders the literal
  placeholder string in Settings copy (stationui.js:2613) and in the copy-success toast. A
  user preparing a bug report is told to email `ANDREW_SUPPORT_EMAIL`. **Verified on trunk
  today. Ship blocker for public release.**

---

## Part 2 — Findings by path (ranked within each path)

### A. First run / onboarding

1. **Silent awakening fallback** (HIGH). LLM birth-script failure degrades to the template with
   zero signal — violates truthful telemetry. onboarding.js:374-415.
2. **Awakening replays on refresh** (MED). `onboarded` isn't persisted until after
   `enterGame()` (app.js:1484, 1517), so a crash mid-ceremony replays it from scratch. Persist
   the flag at ceremony finish; ideally checkpoint per beat.
3. **KeyCTA banner breaks the frame** (MED). Post-awakening "no key" state is a disembodied
   banner (keycta.js), while everything else is the agent speaking. Put the "i have no brain
   wired" line in the agent's diegetic voice, with a button to the CONNECT key field.
4. **API key is assumed knowledge** (MED). "get one at openrouter.ai/keys" (app.js:1460-1467)
   with no "you'll create an account, generate a key, paste it back here" framing.
5. **Skipping the tutorial silently breaks the demo** (MED). Skip kit-out → first-command demo
   fails capdenied because CABINET was never placed (tutorial.js:99), and nothing connects the
   failure to the skip. The demo's own error copy should say "we skipped placing my file
   cabinet — place it and I'll retry."
6. **Provider resets to Codex on return** (LOW). Non-resume reloads discard the previous
   provider choice (app.js:1340-1341).
7. **Pre-filled key can be silently overwritten on resume** (LOW). app.js:1295 — typing in the
   field replaces the stored key with no confirmation.
8. **Interview has no progress indicator or exit signal** (LOW). intake.js:34 hijacks the COMMS
   input; no "Q2 of 5", no "you're all set" close.

### B. Recruiting / creating agents

1. **Post-summon dead-end** (HIGH). "Open REFIT to give it its OWN PC (every agent needs one
   to take floor work)" (app.js:605) — REFIT isn't linked, "OWN PC" is cryptic, and if ignored
   the agent silently can't take floor work. This is a required step presented as a passing
   remark. Make it a one-tap follow-up ("give <name> a desk → [PLACE DESK]") or auto-offer
   desk placement in the summon flow.
2. **Cold-start with no key strands the user in the model picker** (HIGH).
   "no models found — add a provider key in Settings" (modelpicker.js:81) with no link.
3. **The dossier speaks internal dialect** (MED). CLEARANCE/EFFORT/FOCUS/STANDING ORDERS with
   no hints; "DRAWS ON STATION GEAR … not on station — add in REFIT" never says whether
   missing gear blocks summon (it doesn't). marketplace.js:534-542, 628-631.
4. **Custom class builder is buried** (MED) at the bottom of YOUR SPECIALISTS
   (marketplace.js:393-397); kit checkboxes (DISH/CABINET/…) carry no capability descriptions
   in the builder even though the mapping exists (`capGrant`).
5. **Prospect dismiss is permanent + silent** (MED). marketplace.js:1001-1004.
6. **"CURATED FOR YOUR WORKFLOW" doesn't say what was measured** (LOW). The recruiter's "why"
   lines are honest (recruiter.js:106-130) — one more clause ("based on your recent runs")
   completes the trust story.
7. **Hero vs crew mode gives different post-summon instructions with no visible mode** (LOW).
   app.js:600-606.

### C. Giving work & getting results (core loop)

1. **Output files are unfindable** (HIGH). No path, no open-folder, anywhere. chat.js:731,
   artifacts.js:31, fs.js:68.
2. **Approval pause reads as a hang** (HIGH). chat.js:189, 958-960. Needs a loud "paused —
   waiting for YOU" state naming the pending action.
3. **capdenied copy points at the wrong door and omits the capability** (HIGH).
   friendlyerror.js:46.
4. **Quest dismissal is permanent with no confirm** (HIGH). workquests.js:13.
5. **Slash commands are undiscoverable** (MED). Placeholder "speak to your agent…"
   (chat.js:3787) never hints at `/`. Cheap fix: placeholder → "speak to your agent — or type
   / for commands"; add `/help`.
6. **Rating is unexplained** (MED). "👍 nailed it ★ +XP" (chat.js:1083) never says what XP does
   or that 👌/👎 are feedback-only; unrated runs disappear with no pending-count.
7. **Run presence is too quiet** (MED). The presence card (chat.js:168-203) shows raw tool ids
   ("web.search"); a verb-y label ("searching the web…") and a stronger working animation
   would carry it.
8. **Beat gaps look like freezes** (MED). See Theme 2.
9. **Stop reasons leak internals** (LOW). "max_iters" (chat.js:3608).

### D. Settings / keys / models / budget

1. **Support email placeholder** (SHIP BLOCKER). diagnostics.js:24 → stationui.js:2613.
2. **Budget spend readout has no per-scope breakdown** (MED). Users can't see "$22 of $100
   today" per scope/agent; budget.js already computes `scopes{usd,cap,frac}` — render it as
   bars. stationui.js:2524.
3. **Model names are raw slugs** (MED). "claude-opus-4-1" with no human label or fast/smart
   badge anywhere (modeldock.js:6-25, modelpicker.js:77). One label map fixes picker, dossier,
   fallback chain at once.
4. **Env-var overrides silently beat saved settings** (MED). The UI admits it in one line
   (stationui.js:2591-2592) but a user whose saved cap is being overridden gets no indication
   on the field itself.
5. **Voice settings are scattered across three surfaces** (MED). Speaker toggle
   (localStorage), hands-free (COMMS), per-persona ttsStyle/voice/speed (dossier only;
   personas.js:36-92). No VOICE section in Settings.
6. **Import's "secretsNeeded" has no re-entry UI** (MED). configexport.js:143-187 returns the
   list; nothing renders it as "re-enter these keys" prompts.
7. **Provider cards show "○ NO KEY" but key entry lives elsewhere** (LOW). Inline expandable
   key input on the card would remove a hunt. stationui.js:1873-1954.
8. **Keychain storage is invisible** (LOW). After save, one confirmation line ("stored in your
   OS keychain") would buy trust cheaply.
9. **Disabled effort levels are unexplained** (LOW). Codex omits some tiers
   (modeldock.js:26-40); grayed buttons need a "not supported by this model" title.

### E. Skills / recipes / routines / autonomy / memory

1. **Scheduled-but-disarmed routines** (HIGH). See Theme 2. One banner fixes it.
2. **No execution visibility for routines** (MED). No "last ran / next run / what it produced"
   surface; cadence labels ("every morning") never state a time or timezone (cron.js:44).
3. **Locked skills don't say how to unlock** (MED). "● ON · needs CABINET + DISH"
   (stationui.js:1530-1581) with no what/where/how. Link each gear badge to its unlock path.
4. **Autonomy dial jargon + invisible earn path** (MED). Initiative/Reach/Pace are live-apply
   dials with no impact preview ("at this posture the agent will: …"); "earned autonomy"
   offers exist but users never learn what earns trust (autonomystore.js:22).
5. **Suggestions/pitches don't show their reasoning** (MED). The engine grounds every proposal
   in a dossier belief (pitch.js:118) — surfacing "because you said: …" would convert
   "random nag" into "it knows me." Same for interview answers: echo what was learned.
6. **Skills vs Recipes vs Routines taxonomy is never taught** (MED). One one-time card:
   "Skills = what it CAN do. Recipes = ready-made jobs. Routines = jobs on a schedule."
7. **Belief provenance is unlabeled** (LOW). Observed-from-work vs told-by-you beliefs look
   identical in the dossier (dossier.js:86).

### F. Away / return / workshop / desktop lifecycle

1. **"Away" semantics are opaque** (HIGH). See Theme 2. Also: `/build-away` queue-confirm copy
   ("will build this while you're away", chat.js:2848) never states the app-closed condition,
   and queuing with the grant disabled fails quietly (workshopstore.js:89-90).
2. **Return-card verification is not actionable** (HIGH). chat.js:1270-1280. Show the commands
   and distinguish "no tests defined" from "tests failed."
3. **Keep-path input is hostile** (MED). Absolute path typing, silent failure. chat.js:1355-1366.
4. **Away digest fires once and never again** (MED). Dismiss forgets all rows silently
   (returnstore.js:60-62); the OUTBOX crate becomes the only clue, and clicking it opens a
   rating control when users expect run content.
5. **Update UX gaps** (MED). "Critical" is never defined; notes truncate at 520 chars with no
   "view full"; restart is abrupt with no in-flight-run warning; install failure doesn't
   auto-retry (updates.js:49, 139, 182-186).
6. **Installer double-warning confusion** (MED, mostly docs). SmartScreen (bypassable) and SAC
   (hard block) look identical to a beginner; INSTALL.md should show the two flows side by
   side with screenshots.
7. **Crash recovery is silent** (MED). Respawn works; the user is never told the previous run
   was lost. main.rs:700-710.

---

## Part 3 — Prioritized fix plan

### P0 — trust breakers & dead-ends (do before wider release)

1. **Real support email** — one-constant swap once Andrew picks the address (diagnostics.js:24).
2. **capdenied copy v2** — name the capability, add an action button to the actual unlock
   (friendlyerror.js:46 + the classifier already has the raw message to parse the cap from).
3. **Route "no key/model" errors to the key field** — action buttons on auth errors +
   modelpicker's stranded state (friendlyerror.js, modelpicker.js:81).
4. **"Open folder" on file deliverables + workspace path on recap card** (chat.js:731, 855).
5. **Routines-disarmed banner** wherever a routine is created/listed while initiative='wait'.
6. **Away-workshop honesty** — state the app-closed condition at queue time; error toast when
   the grant is off; heartbeat/"away mode" indicator.
7. **Approval-pause state** — explicit paused styling + name the pending action (chat.js:189).
8. **Confirm on quest dismiss and prospect dismiss** (reuse the existing 2-step arm pattern).

### P1 — comprehension (biggest confusion per unit effort)

9. Post-summon follow-up: one-tap "give <name> a desk" instead of the REFIT sentence (app.js:605).
10. Glossary/tooltip layer + copy pass on the Theme-1 jargon table.
11. Human model labels + tier badges (one map, used by dock/picker/fallback/dossier).
12. Budget spend bars per scope (data already in `/api/budget/status`).
13. Slash-command discoverability: placeholder hint + `/help`.
14. Rating explainer + pending-rating badge; beat-queue "next…" indicator.
15. Return card: verification detail + folder picker for Keep.
16. Diegetic no-key narration replacing the KeyCTA banner.
17. Persist `onboarded` at ceremony finish; surface the awakening's live-vs-template state
    honestly (even a subtle "(offline script)" marker satisfies the telemetry law).

### P2 — connective tissue & polish

18. One-time "how it fits together" card (Skills/Recipes/Routines/Autonomy/Memory) + cross-links.
19. "Because you said: …" grounding lines on pitches, standing-job proposals, and recruiter shelf.
20. Routine execution log (last run / next run / produced) + timezone-explicit cadence labels.
21. Autonomy posture impact preview + earned-trust explanation.
22. Voice settings unified into a Settings VOICE section.
23. Import secrets re-entry modal; env-var-override indicator on affected fields.
24. Update center: full notes link, defined "critical", pre-restart warning, retry on failure.
25. Interview progress indicator; belief provenance badges; crash-recovery notice line.

---

## Verification status

- Grounded in trunk code by six parallel read-only audits; **no code was changed**.
- Re-verified by direct grep on trunk today: `ANDREW_SUPPORT_EMAIL` placeholder
  (diagnostics.js:24, rendered at stationui.js:2613), the REFIT/"OWN PC" post-summon copy
  (app.js:605), and the capdenied→SKILLS copy (friendlyerror.js:46).
- Not verified live in-app this session (no free preview slots); line numbers are from today's
  trunk reads. Individual findings should be re-grepped before building fixes, per doctrine —
  several lanes are in flight and numbers will drift.
