# Skill-building parity plan — the reference harness capability, StarNet visibility

Date: 2026-07-02. Grounded in a dual code audit (StarNet trunk + harness-ref), not plan docs.

## Diagnosis (why it FEELS like agents don't build skills)

The backend already replicates the reference harness's skill machinery almost 1:1 — the gap is **visibility
and breadth**, not machinery:

| the reference harness mechanism | StarNet equivalent | Status |
|---|---|---|
| `skill_view` / `skills_list` (lazy bodies) | `skill.view` / `skill.list` (sidecar/tools/builtin/skills.js) | EXISTS |
| `skill_manage` create/edit/patch/delete + support files | `skill.manage` + package store (skillstore.js, skills/package.js) | EXISTS |
| Descriptions-only index in system prompt | `runtimeSkills.composeIndex` @ index.js:3307 (6k budget) | EXISTS |
| Frontmatter validation + security scan | guard.js `scanSkillRecord` | EXISTS |
| Usage telemetry + curator (stale/archive/pin) | skillstore counts + skillcurator.js | EXISTS |
| Background "distill this run into a skill" | skillreview.js + runBackgroundSkillReview @ index.js:894 | EXISTS — **but 100% silent** (`emit: () => {}`) |
| Bundled skill library | sidecar/skills/library/ | EXISTS — **only 9 skills** |

Three real problems:

1. **Everything skill-shaped is invisible.** The background skill review creates/patches
   skills after complex runs with a no-op emitter — no COMMS beat, no deliverable event, no
   SKILLS-panel refresh. `skill.view`/`skill.manage` in-run render as generic tool beats.
   Result: skills get built and nobody ever sees it happen.
2. **In-run skill tools are notebook-gated.** All four `skill.*` tools ride the `memory`
   capability (capability/registry.js:27-30) = NOTEBOOK object. No notebook on the floor →
   no skill index in the prompt, no skill tools, agent cannot consult or save skills in-run.
   (The gate is the object=capability law — KEEP it; the fix is making the consequence
   legible, not removing the gate.)
3. **Library is thin.** 9 bundled recipes vs the reference harness's full `skills/<category>/` tree.
   Plus the AGENT SKILLS search box in stationui.js (~1345) has no handler.

## Build lanes

### Lane A — skill activity in COMMS + live SKILLS menu (worktree: skill-comms)
- **A1** Skill-flavored tool beats in COMMS: `skill.view` → "consulting skill: <name>";
  `skill.list` → "scanning skill index"; `skill.manage` create/edit/patch → "wrote skill
  <name> → SKILLS menu". Ride the EXISTING `agent.tool_call`/`agent.tool_result` events —
  frontend rendering only (chat.js tool phrasing + world.js notebook pulse already fires).
- **A2** Un-silence the background skill review: emit the EXISTING `deliverable` event
  (kind:'skill') when it creates/patches, plus a COMMS aside in the shared gold-inset beat
  family ("distilled this run into skill: <name>"). NO new events in shared/events.js —
  `deliverable` already carries it. Asides follow COMMS beat rules (no `.reply`, decided
  cards vanish, respect the one-beat post-run slot arbiter from growth-t1 — a skill aside
  must NOT fight the study/consent beat; if the slot is taken, queue or drop, never stack).
- **A3** SKILLS panel goes live: AGENT SKILLS section refreshes on `deliverable`
  kind:'skill' so a newly created skill appears in the menu without reopening the panel.
- **A4** Wire the AGENT SKILLS search box (filter by name/summary/category, client-side).

### Lane B — library breadth (worktree: skill-library)
- **B1** Port 15–25 more the reference harness skills from `C:\Users\<you>\harness-ref\skills\` into
  `sidecar/skills/library/*.md` using the existing frontmatter format (catalog.js grammar:
  name/slug/description/category/requires/author/license/default). Map each skill's needs
  to `requires:` capability objects honestly (web skills → dish, terminal → workbench,
  files → cabinet, etc.). Keep attribution lines like the existing 9. Skip the reference harness skills
  that assume ref-only infra (kanban, its plugin system).
- **B2** Respect the 12k compose budget — most ports should be `default: false` so they're
  toggleable in the SKILL LIBRARY panel without blowing the prompt budget; keep on-by-default
  only the universally useful ones.
- **B3** Category headers in the panel already render — verify grouping looks right with
  25+ skills; add a count badge per category if trivial.

### Lane C — creation-rate polish (fold into Lane A unless it grows)
- **C1** Verify skillreview trigger (≥4 tool calls OR ≥8 turns OR ≥5000 chars) fires in
  realistic runs; log a one-line ledger/status entry per review pass so it's auditable.
- **C2** Onboarding/capsummary already says NOTEBOOK = memory+skills; confirm the kit
  requisition quest pitches the notebook as "where skills live" (grep first — may exist).

## Rules for implementers
- Worktrees only (`gen-trees\new-agent-tree.ps1 <name>`), never the integration tree.
- **Do NOT touch shared/events.js / shared/schema.js** — every event needed
  (`deliverable`, `agent.tool_call`, `agent.tool_result`, `task`) already exists.
- Grep trunk before building each item — audit claims go stale in hours.
- `npm run test:fast` green before merge; extend test/skills.test.js for A2 emit and
  test/skills.library.test.js Part C count for B1.
