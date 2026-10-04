# UX Confusion Audit — Skills / Toolsets / Recipes / Routines / Tasks / Quests / Channels
2026-07-15 · branch `claude/starnet-ux-confusion-audit-a6a1fe` · method: code sweep (3 explorers) + live walkthrough of a fresh seeded station (`dev/seed.js`, port 9031). All UI quotes below were confirmed live in the running app unless marked (code).

## Verdict
The features are individually sound, but the **vocabulary layer collapses for a first-time user**. Seven nouns are presented as peers in two dock menus with one-line subtitles, the glossary defines only 3 of them, the locked doctrine (Skills=HOW / Recipes=WHAT / Routines=WHEN) appears nowhere in the UI, and several features can produce each other's artifacts with no signpost.

---

## Finding 1 — SKILLS vs TOOLSETS: the same 7 capability families, two panels, two vocabularies (SEVERITY: highest)
- SKILLS→CAPABILITIES (read-only, `stationui.js:1651-1698`) and TOOLSETS (toggles, `stationui.js:4348+`, `sidecar/capability/toolsets.js`) render the **same CAP_REGISTRY families** under different names:
  - `web` = "WEB SEARCH"/"WEB FETCH" (SKILLS) vs "WEB & BROWSER" (TOOLSETS)
  - `cabinet` = "READ FILES"/"WRITE FILES" vs "FILE CABINET"
  - `workbench` = "TERMINAL" vs "WORKBENCH (CODE EXECUTION)"
  - `memory` = "MEMORY" vs "MEMORY NOTEBOOK"
- Live-verified failure path: fresh user opens **SKILLS** ("what agents are equipped to do" — the more capability-sounding button), sees "1 of 7 live", six greyed rows saying "○ NO DISH AT DESK ▸ PLACE IN REFIT" — and **no pointer to TOOLSETS** where the actual kill-switches live. The code already admits they're one thing: SKILLS fetches `/api/toolsets` to dim perks (`stationui.js:1724-1734`; `app.css:2546` "honesty parity").
- One name mismatch compounds it: SKILLS says "place a DISH", TOOLSETS says "no dish on station" but titles the family "WEB & BROWSER" — a user can't connect prop-noun to family-noun.

**Fix direction:** merge into one panel (CAPABILITIES with a per-row switch), or at minimum (a) each greyed SKILLS row links to its TOOLSETS switch and REFIT prop, (b) unify names — one label per family everywhere, (c) rename the dock pair so they stop competing: SKILLS→"PLAYBOOKS" or fold CAPABILITIES tab into TOOLSETS.

## Finding 2 — the word "skill" means four things
(a) capability readout (CAPABILITIES tab), (b) bundled SKILL LIBRARY recipes (`sidecar/skills/library`), (c) AGENT SKILLS the agent writes at runtime (`sidecar/skillstore.js`), (d) class-loadout `skills:[...]` (`shared/specialties.js`). Three of these sit as sibling tabs in one panel. And "SKILL LIBRARY" describes its entries as "**recipes**" (`stationui.js:1700,1710`) while RECIPES is a different dock feature — the two nouns are swapped inside each other's panels.

**Fix direction:** stop calling library entries "recipes" (call them procedures/playbooks); rename the CAPABILITIES tab out of the "skills" word entirely (it's gear, not skill).

## Finding 3 — RECIPES vs ROUTINES: duplicate scheduling paths, glossary defines both as "a job"
- Recipe launch form has "◷ MAKE ROUTINE" (`marketplace.js:1826-1831`) writing the same cron store as the ROUTINES panel form — two unrelated dock entries produce the identical artifact, no cross-reference either way.
- `glossary.js:34-35`: recipe = "a ready-made job…", routine = "a job set to run on a schedule…". The HOW/WHAT/WHEN triad exists only in `docs/DECISIONS.md:26` — never in UI.
**Fix direction:** state the triad in the WORK dock menu itself (subtitle each entry with its axis); in ROUTINES' create form, suggest matching recipes ("start from a recipe?"); in RECIPES, label MAKE ROUTINE as "…creates a ROUTINE (see ⏱ ROUTINES)".

## Finding 4 — TASKS vs QUESTS: same unit of work, two windows
- A launched recipe → workstream `kind:'task'` → TASK BOARD. An accepted agent idea → WORK QUEST → QUEST LOG (`workquests.js`). Same primitive (directive → run), two surfaces, chosen by entry path.
- QUEST LOG folds 6+ quest kinds (ledger/work/maintenance/station-gap/arc/dossier/milestone) and even shows routine language live: "SKIPPED no provider credential — connect a OPENROUTER API key to run this **routine**".
- Glossary defines **neither** "task" nor "quest".
**Fix direction:** position QUESTS purely as "progress & suggestions" (never a place work lives); when a work-quest run starts, mirror a card on the TASK BOARD (one home for in-flight work); add task+quest glossary entries.

## Finding 5 — CHANNELS vs CONNECTORS: inbound vs outbound, presented as siblings
- Semantically opposite (CHANNELS = how *you* reach the agent; CONNECTORS = tools the *agent* reaches out with) but adjacent in BUILD with rhyming subtitles ("wire external tools in" / "reach your agents from your messaging apps"), and **Slack appears in both** (channel card `stationui.js:3941`; connector example `:4358`).
- TOOLSETS button subtitle "wire external tools in" describes the MCP tab, not the toolsets tab the panel is named for — and the panel opens on CATALOG (connector storefront), so a user clicking "TOOLSETS" first sees connectors (live-verified).
- The connector portal prop editor points to "the ⇄ CONNECTORS panel" (`build.js:677`) — a label that doesn't exist (button says TOOLSETS). Quest log calls it a third thing: "Bind a live **tool portal**".
**Fix direction:** subtitle by direction — CHANNELS "talk to your agents from Slack/Telegram/Discord", TOOLSETS "give agents tools & external services (MCP)"; fix the `build.js:677` label; unify portal/connector wording; open the panel on the TOOLSETS tab, not CATALOG.

## Finding 6 — onboarding introduces 4 of the 7 concepts never
Awakening + kit-out tour teach capabilities, consent, crew, quests (and "skill library" in one clause, `tutorial.js:113`). **Recipes, routines, tasks, channels are never introduced** — they just sit in dock menus. First-steps checklist includes "connector" but not "channel"; connectors are reachable 3 ways, channels 2 (asymmetric discoverability).
**Fix direction:** after the tour's quest handoff, one beat: "when you want ready-made work, hit ❒ RECIPES; anything you launch lands on ☑ TASKS; put it on a schedule and it becomes a ⏱ ROUTINE." Add a channels first-step ("get me in your pocket — connect Telegram").

## Finding 7 — the glossary is the right instrument, half-loaded
`glossary.js` (the first-minute hover-help layer) defines routine/recipe/skill only. Missing: task, quest, toolset, connector, channel, capability. The dock buttons even carry `data-term` hooks already.

---

## Recommended priority order
1. **Glossary completion + doctrine subtitles** (cheap, pure copy): add the 5 missing terms; restate every dock subtitle on one axis — WHAT you can do (SKILLS-gear), WHAT to run (RECIPES), WHEN it runs (ROUTINES), WHERE work lives (TASKS), progress (QUESTS), agent's tools out (TOOLSETS), your way in (CHANNELS).
2. **SKILLS↔TOOLSETS unification** (Finding 1) — one vocabulary, cross-links, or a single panel.
3. **Cross-links at the duplicate paths** (MAKE ROUTINE ↔ ROUTINES; work-quest ↔ TASK BOARD).
4. **Rename collisions**: library "recipes"→"procedures"; "tool portal"/"⇄ CONNECTORS" label fixes; Slack disambiguation line in both panels ("looking to DM your agent? → CHANNELS" / "want the agent to act in Slack? → TOOLSETS").
5. **Onboarding beat** for recipes/tasks/routines/channels (Finding 6).

## Not verified
- Marketplace RECIPE DOSSIER / MAKE ROUTINE form walked in code only (marketplace.js), not clicked live.
- No user testing — this is a heuristic audit; the severity ranking is judgment.
