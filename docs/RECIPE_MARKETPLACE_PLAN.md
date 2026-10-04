# Recipe Marketplace — use cases with real freedom

**Locked direction (Andrew, 2026-07-02):** Recipes exist to solve the #1 adoption problem of
agent platforms (OpenClaw, the reference harness, everyone): *users don't know what to use agents for*.
Recipes are the marketplace of preconfigured use cases. A recipe should spark the idea, then
give the user total freedom with it: tweak it, run it once, or put it on a schedule.

**Mental model after this ships:**
- **Skills = HOW** the agent works (capability-gated procedures, injected). Unchanged.
- **Recipes = WHAT** to do (browsable, forkable, parameterized use cases). This plan.
- **Routines = WHEN** it happens (a recipe — or any prompt — on a schedule). Already real; gets wired to recipes.

## Non-negotiable laws

1. **Recipes never gate execution.** Gear badges are advisory + quest hooks, not locks
   (sandbox/no-gating rule). A user can always launch anyway.
2. **One post-run beat at a time; decided cards vanish** (COMMS beat rules).
3. **Truthful telemetry** — a routine minted from a recipe shows real provenance, real fire
   history. No fake "popular" counts on builtins.
4. **Additive only** in `shared/events.js` / `shared/schema.js` (owned by cortex-memory lane).

## Current state (mapped 2026-07-02)

- `frontend/app/recipes.js` — schema `{id,name,emoji,tagline,blurb,accent,tags,params,task,custom}`,
  10 builtins, custom store in `localStorage.starnet.recipes.v1`, `fillTask()` token substitution.
- Launch path: `app.js launchRecipe()` → new workstream → `Chat.send(directive,{isTask:true})`.
- Marketplace UI: `frontend/app/marketplace.js:303–380` (RECIPES tab roster + dossier + launch).
- Cron: `sidecar/cron.js` + `POST /api/cron` — full scheduler (interval/once/5-field, tz). **Zero wiring to recipes.**
- AutoJobs (`frontend/app/autojobs.js`): `toCronBody()` + a 4-option cadence menu — the exact
  conversion shape R3 needs, already proven.
- Skills library (`sidecar/skills/catalog.js`): `requires:[objectType]` gear-gating vocabulary +
  WANT-state UI pattern in `stationui.js` — reuse both.

## Slices

### R1 — Schema v2: recipes that can carry freedom
Additive fields on the recipe object (builtins + customs):
- `gear: [objectType,...]` — what station objects this use case wants (same vocabulary as
  skills `requires`). Advisory only.
- `skills: [slug,...]` — optional bundled-skill references ("this use case pairs with feed-watch").
- `cadence: string|null` — a *suggested* cadence id ('morning' etc.) for use cases that are
  naturally recurring (Morning Brief suggests 'morning'). Null = one-shot by nature.
- `category: string` — replaces lane-only tags for browsing (keep `tags` for ranking).
- `source: 'builtin'|'custom'|'fork'`, `forkedFrom: id|null` — provenance.
- Custom store migrates v1 → v2 (fill defaults; never drop user recipes).
- `fillTask()` unchanged.

### R2 — Tweak/fork: every recipe is editable
- Every recipe dossier gets **TWEAK** → opens the recipe editor **pre-filled** with that
  recipe's name/emoji/params/task/gear/cadence. Save mints a custom recipe with
  `source:'fork', forkedFrom:<id>`. Builtins stay immutable; forks are yours.
- The existing blank "create a recipe" flow becomes the same editor with an empty form —
  one editor component, two entry points.
- Editor upgrades: param row add/remove, live preview of the filled task (sample values),
  gear picker (checkbox row of the 7 capability types), category select, cadence select
  (none/morning/weekly/sixhourly/hourly).
- This is what makes "create" different from prompting: you start from a working use case,
  not a blank box.

### R3 — Run now OR make it a routine (the cron wiring)
- Recipe launch pane gets two verbs after params are filled:
  - **RUN NOW** — existing path, unchanged.
  - **MAKE ROUTINE** — cadence picker (default = recipe's suggested `cadence`, plus the
    4 standard options and a custom `every Nh` / 5-field entry) → `POST /api/cron` with
    `{ name: recipe.name, prompt: fillTask(recipe, values), schedule, agentId, enabled:true,
    deliver:'local', repeat:{times:null}, meta:{recipeId} }`.
  - Params are filled ONCE at schedule time (the routine runs the filled directive verbatim).
- `meta.recipeId` (additive cron-job field) so ROUTINES console shows "from recipe: Morning
  Brief" and the recipe dossier shows "● live as a routine — every morning" with a jump link.
- Guardrail copy: scheduling an unattended routine shows the same reasoning-only expectations
  autojobs enforce IF the recipe's task implies sends/writes — warn, don't block (law 1).

### R4 — Catalog expansion: 10 → ~50 real use cases
- Move builtins from inline `recipes.js` literals to a data catalog (module or JSON, mirroring
  `sidecar/skills/library` authoring ergonomics) so content scales without touching logic.
- Author ~50 use cases across personas: **developer** (bug triage, PR sweep, dep audit…),
  **researcher** (feed watch, lit review, fact-check…), **creator** (content repurpose, hook
  drafts, comment digest…), **ops/personal** (inbox triage brief, meeting prep, weekly review,
  price/stock watch…). Each with honest `gear`, sensible `cadence`, tight task template.
  Naturally-recurring ones get `cadence`; paired ones get `skills` refs.
- Gear-aware browsing: recipes whose `gear` the station lacks render with a WANT badge
  (skills-panel pattern) → click = the prop-gate hook (drives object purchases; object=capability moat).
- "FOR YOU" row: rank by dossier interests/goals using existing `tags` weighting + goal-text
  keyword match. Honest fallback order when dossier is thin.

### R5 — Bottle a run (save what worked)
- Post-run beat (shared beat slot, gold-inset family): when a completed interactive run's
  directive did NOT come from a recipe and the user rated it 👍, offer **"Bottle it?"** —
  one tap mints a custom recipe from the run's directive (agent proposes name/params by
  templating the obvious variables; user confirms in the R2 editor pre-filled).
- Mirrors the agent-skill `sourceRunId` pattern; store `sourceRunId` on the recipe.
- Budgeted like other asks (work-driven ask budget; dismiss = don't re-offer for that run).

### R6 — Marketplace surface
- RECIPES tab becomes the discovery front: category rail, search, FOR YOU row, gear badges,
  live-routine badges, fork provenance line. Reuse premium card language (motion.css tokens).
- Export/import a recipe as JSON (single file) — the seed of the open-core marketplace unit;
  no network sharing yet, just a clean portable format.

## Build order & gating

R1 → R2 → R3 is the freedom loop and ships together (a recipe you can't tweak or schedule is
still a dead end). R4 content can run in parallel once R1's schema lands. R5 and R6 follow.
Each slice: own worktree, `npm run test:fast` green, rebase before merge (CLAUDE.md protocol).

## Out of scope (explicitly)

- Networked marketplace / sharing backend (export format only for now).
- Recipes gating tools or modifying agent loadouts — they stay pure directives.
- Merging recipes with agent skills — different nouns (WHAT vs HOW), keep separate.
- Recurring param prompts ("ask me the topic each morning") — v2 candidate, not now.
