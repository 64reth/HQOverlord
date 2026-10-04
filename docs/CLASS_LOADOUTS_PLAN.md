# Class Loadouts — specialized agents that actually do what the class suggests

**Branch:** `agent/class-loadouts` · **Date:** 2026-07-02 · **Status:** building

## ⚑ CORRECTION — 2026-07-02: the shared-gear model (overrides the "kit" design below)

Andrew (commander): **"The only prop a specialized or secondary agent needs is its own desk; it's allowed to
use other props with the overseer."**

Capabilities are **STATION-level shared gear used under the overseer**; the **desk is the only per-agent
object**. Per-agent prop issuance was wrong — it duplicated props and misread the model. So a class's `kit` is
**NOT** requisitioned to the agent's workstation. It now names the **shared station gear the class draws on**:

- **`kit` = informational + a gate, never a placement.** It is shown in the dossier as "DRAWS ON STATION GEAR"
  with a live present/missing check against the ACTUAL station props (`World.stationCaps`), and it gates the
  class's **skill availability** (skills are recipes; the gear they need is the station's shared gear).
- **Removed entirely:** `requisitionKit` / `setPendingKit` / `deliverPendingKit` / the `pendingKit` field /
  `Build.requisitionForAgent` / the `onAgentRoomAssigned` room-assign hook + summon-time placement + its toasts.
  No dead code (janitor law).
- **Skill availability is now STATION-WIDE.** The interactive run gates a specialist's class skills on the
  station's shared gear (`stationPlaced` = `World.stationCaps()`), not the agent's desk-only room — so a
  specialist with just a desk still gets its class skills when the station has the required gear. **Tool** reach
  stays room-scoped (`resolveTools` untouched); the overseer/dispatch path grants the worker its office.
- **Summon copy:** no "kit arrives when it gets a workstation." If the station lacks gear the class draws on, one
  honest line ("station lacks … — add … in REFIT for its full toolkit"); otherwise nothing.

The "kit / STANDARD ISSUE KIT / requisition" design in the sections below is **superseded** by this note; it is
kept for history. Read `kit` everywhere below as "shared station gear the class draws on."

## Why

Today a "class" (specialty) is ~a paragraph: `purpose` + `manual` text injected into the
system prompt, a persona hint, and an *advisory* model-tier pip. It does NOT:

- kit the workstation (a Researcher can spawn with no dish → no `web_search` at all),
- enable any skills (skill prefs are GLOBAL slug→bool, `sidecar/skills/prefs.js:20`),
- actually apply its model tier (pips are cosmetic; roster model comes from elsewhere),
- exist backend-side (`team.summon`'s class list is hardcoded prose, `sidecar/index.js:~3188`).

**The upgrade: a class is a full loadout** — expert playbook + standard-issue kit +
skill package + applied model/effort defaults — with one catalog consumed by both the
Recruitment Bay and the backend, so lead-summoned specialists are kitted too.

## Laws (do not violate)

1. **Object = capability stays honest — SHARED at station level (corrected 2026-07-02).**
   A class's `kit` is the **shared station gear it draws on under the overseer**, not per-agent
   props. It is informational (dossier "DRAWS ON STATION GEAR" with a live present/missing
   check) and gates the class's **skill availability** against the station's real gear
   (`World.stationCaps`). The only per-agent object is the desk. Never a per-agent placement,
   never a flag. (Superseded the original "REAL prop placement at the new agent's workstation".)
2. **Defaults, never locks** (sandbox law). Summon *applies* class model/effort/skills
   to the agent record; the user can override everything afterward, per agent.
3. **Additive only** in `shared/events.js` / `shared/schema.js` (owned contract —
   request changes, don't make them). New shared files are allowed.
4. **Grounded classes only.** Every class's playbook may only reference tools its kit
   actually grants (web, fs, shell, image, spotify, notebook, routines, team.*, MCP).
5. Green `npm run test:fast` before merge; additive roster fields (old saves load).

## Verified coordinates (grep-confirmed 2026-07-02)

| Seam | Where |
|---|---|
| Class catalog (11 specialties, frozen) | `frontend/app/specialties.js:80-180` |
| applySpecialty / summonAgent / composeSystemPrompt | `frontend/app/app.js:388-414, 120-149` |
| Class seals / codes / pips | `frontend/app/classicons.js:24-41` |
| Sys-prompt assembly (runOnce) | `sidecar/index.js:3245` |
| Roster (agentId→system,name,model,provider,role,approvalMode) | `sidecar/index.js:543-573`, POST `/api/roster` :1900 |
| Model/provider precedence (run > roster > default) | `sidecar/index.js:2760-2767` |
| Capability projection (room objects → tools) | `sidecar/capability/resolve.js:21` |
| Skills compose (global prefs + placedTypes, ~12k budget) | `sidecar/skills/catalog.js:114`, inject `sidecar/index.js:3205` |
| Skill prefs = GLOBAL slug→bool | `sidecar/skills/prefs.js:20-34` |
| team.dispatch/spawn/summon | `sidecar/tools/builtin/orchestration.js:74-295` |
| crew.summon.request event (requestId, agentId, name, specId, persona, skin, purpose) | `shared/events.js` |
| Kit requisition real-placement invariants | `test/kitout.test.js` |

## Design

### Catalog: one source of truth
Move the specialty catalog to `shared/specialties.js` (UMD, same pattern as
`shared/events.js` / `capability/resolve.js`). `frontend/app/specialties.js` keeps its
public API (BUILTINS, compose, TIERS…) but reads from shared. Sidecar requires it for
`team.summon` class listing + summon defaults. **No hardcoded class prose in index.js.**

### Loadout fields (added to every specialty)
```js
{
  ...existing (id, name, emoji, tagline, blurb, purpose, manual, persona, model, accent, tags, starters),
  kit:    ['dish','cabinet','notebook', ...],   // objectTypes auto-requisitioned at summon
  skills: ['deep-research', ...],               // catalog slugs enabled for THIS agent
  reasoningEffort: 'high'|'medium'|'low'|null,  // applied default (roster), advisory pips stay
}
```
Tier→model mapping stays indirection: `model:'reasoning'|'balanced'|'fast'` resolves at
summon through the user's configured tier→model settings (or current default model)
so we never hardcode a model id in the catalog.

### Summon applies the loadout (frontend `summonAgent`)
1. applySpecialty (purpose/manual) — as today.
2. Resolve tier → concrete model + reasoningEffort → set on agent record → pushRoster.
3. **Kit requisition:** place `spec.kit` objects at the new agent's workstation through
   the real validated placement path (generalize `Build.requisition` to target a given
   agent's room; skip objects already present; visible in-world).
4. **Skill package:** per-agent skills recorded on the agent + pushed in roster.

### Sidecar: per-agent skill enablement (additive)
- Roster record gains `skills: string[]` (and `reasoningEffort`). POST /api/roster passes through.
- `skillsCatalog.compose` gains `agentSkills` — union with global overrides
  (per-agent enable can only ADD, never disable a globally-enabled skill). Still
  capability-gated by placedTypes and 12k budget.
- `resolveReasoningEffort(providerId, o.reasoningEffort || rosterIdent.reasoningEffort)`
  at `sidecar/index.js:2764`.

### team.summon backend
Class list in the tool description composed from shared catalog (id + tagline).
`crew.summon.request` already carries `specId` — frontend summon path does the rest,
so lead-summoned specialists get the identical loadout. Additive event fields only if needed.

### Expert playbooks (the "truly skilled" half)
Rewrite `purpose` + `manual` for ALL classes into expert operating procedure:
concrete, tool-referential (name the actual tools the kit grants), with method
(e.g. Researcher: multi-query sweep → cross-check ≥2 independent sources → lead with
answer → cite; Reviewer: reproduce → localize → adversarial verify → severity-ranked),
failure honesty, and output format. Keep each manual ≤ ~12 bullets; purpose 2-4 sentences.
Voice: competent-professional, station-flavored, eerie-not-cute.

### New classes (variety — each must be kit-grounded)
Add ~7: **broker** (deal/price scout: web+notebook+routines), **publicist**
(announcements/social copy: web+cabinet), **tutor** (teach/study plans: web+notebook),
**auditor** (file/code security & consistency sweeps: cabinet+workbench),
**bookkeeper** (budgets/spreadsheets/expense logs: cabinet+workbench),
**translator** (translate/localize docs: cabinet), **herald** (channel digests &
comms: dish+notebook+routines). Each gets seal icon + 3-letter code in classicons.js,
accent, tags, starters, kit, skills, playbook. Adjust only if a kit can't honestly
back the class.

### New library skills (class packages need substance)
Author new `sidecar/skills/library/*.md` skills where a class package lacks a matching
recipe (e.g. price-watch, changelog-digest, ledger-upkeep, translation-pass,
source-triangulation, adversarial-review-pass). Same frontmatter format; `requires:`
must match the class kit; `default:false` (enabled via class package).

### UI
Recruitment Bay two-pane dossier gains **STANDARD ISSUE KIT** (prop icons + what each
grants) and **SKILL PACKAGE** rows; tier pips become "APPLIED AT SUMMON". Custom-class
builder (＋ tile) gets kit/skill pickers so user classes are loadouts too.

## Slices (each: Opus build → adversarial sweep → fixes → gate)

- **S1 — Spine:** shared catalog + loadout fields + summon applies model/effort/kit/skills
  + sidecar per-agent skills/effort + team.summon dynamic class list. Tests:
  `test/class-loadouts.test.js` (source invariants like kitout.test.js) + unit tests for
  compose(agentSkills) and roster passthrough.
- **S2 — Content:** expert playbooks for all existing classes + 7 new classes + seals/codes
  + new library skills. Test: catalog lint (every kit objectType exists in CAP_REGISTRY;
  every skill slug exists; every manual only names tools its kit grants).
- **S3 — UI:** bay dossier loadout sections + custom builder pickers + summon dialogue
  copy. Headless boot smoke + screenshot check.

## Risks
- Workstation may lack floor space for a kit → requisition must degrade gracefully
  (place what fits, surface what didn't as a quest/needs-chip, never crash).
- Old saves: agents without `skills`/`reasoningEffort` fields must behave exactly as today.
- Skill budget: class packages + global enables must respect the 12k compose cap
  (packages ordered first).
