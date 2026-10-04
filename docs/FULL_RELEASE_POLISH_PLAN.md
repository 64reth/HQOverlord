# StarNet — Full-Release Polish Plan (2026-07-02)

> The "fill in the walls, add the roof" plan: every layer verified against CODE (not stale
> plan docs) by a 4-agent audit on trunk @95325fc. Goal: pristine full-release condition —
> beyond the reference harness parity, gamification complete, everything wired, nothing stranded.
> Supersedes REF_HARNESS_PARITY_PLAN.md and the polish portions of AUTONOMOUS_BUILD_PLAN.md.

## Audit verdict (ground truth, 2026-07-02)

- **the reference harness parity: 10/11 core items SHIPPED in code** (resume/recall, shell hardening,
  observability, skills, compaction, retry-after, Discord full-duplex adapter, credential
  rotation, memory hygiene). One PARTIAL: no-op turn refund in iteration budget.
- **Gamification: 6/10 shipped and honest** (rate-the-work + size-weighted XP IS live —
  chat.js:649/xp.js:28; quests/mission board, pride/returns/OUTBOX, XP/level-up, onboarding
  ceremony, app-lies sweep clean). Gaps: Meeseeks sprites don't render, seed-shelf save flow
  unwired, memory/question overhaul unbuilt, G5 spectacle deferred.
- **Wiring: release rail + return loop genuinely done.** Stranded: zero-to-value demo mode,
  billing.js (fully unwired), settings P1 rows, Discord inbound WS, zones.test not in
  test:fast, ~20 actionable skynet.* rename items.
- **Branches: 29 unmerged; ~21 carry real work (~23k lines), 4 are noise.** Triage verdicts
  need per-branch supersession re-checks (several June-24–26 branches predate trunk work
  that may have shipped the same thing).
- **Trunk QA: RED — 14 open Guardian findings**, 12 are golden-frame diffs from the
  intentional ui-premium palette sweep (1f1d759).

---

## P0 — Green trunk + cheap hygiene (first, ~half a day)

| # | Item | Detail | Effort |
|---|------|--------|--------|
| P0-1 | Guardian back to GREEN | Vision-check the 12 golden-diff frames against the palette-sweep intent; re-bake goldens for accepted changes; investigate the 2 non-golden findings; close ledger entries | S |
| P0-2 | zones.test → test:fast | Add `node test/zones.test.js` to `test:fast:raw` chain in package.json (long-standing task chip) | XS |
| P0-3 | Delete 4 noise branches | `agent/starnet-api-gate` (superseded), `agent/starnet-tests-tauri` (obsolete WIP), `agent/side-priority` + `agent/starnet-release-gate` (doc-only) — after a 30-sec eyeball each | XS |

## P1 — Land the stranded branches (the "walls")

~21 merge-candidate branches, one at a time into trunk, using the proven coexistence
pattern (memory: codex-coexistence-merge-pattern): **verify-supersession first** (grep trunk
for the branch's key symbols — several triage verdicts are optimistic), sync/rebase in the
branch's worktree, `test:fast` green, merge, grep symbols after every hotfile merge.

Order (re-verify each before merging; demote to DELETE if trunk already has it):

- **Tier 1 — big value, big risk:** `hermes-parity-loop` (42 commits, desktop-gate
  hardening — HIGH supersession risk: trunk already has t0–t5 + shipped v0.1.3; salvage
  only what's genuinely new), `parity-finish` (CAP_REGISTRY fs.patch + MCP stdio tests),
  `cortex-hermes-plus` (review turn-in learning).
- **Tier 2 — features:** `slash-plan1..plan5-6` (ATOMIC series — merge in order, never
  cherry-pick), `skill-builder-gap`, `quick-model-selector` (check vs shipped P0-3 model
  chain), `prop-sprite-templates`.
- **Tier 3 — hardening:** `starnet-memory-consent`, `starnet-hardening-5-6-memory-consent`,
  `starnet-memory-loop`, `starnet-hardening-1-2-api-gate`,
  `starnet-hardening-3-4-remote-files`, `starnet-remote-files`,
  `starnet-hardening-7-8-tests-tauri`.
- **Tier 4 — polish utilities:** `work-visibility` (fresh 07-01), `workstreams-sessions-ui`,
  `routine-run-now`, `cron-staylive`, `commission-redux` (verify test coverage),
  `ui-number-format`, `memory-cortex` (1-liner).

Tear down each worktree after merge (`remove-agent-tree.ps1 <name> -DeleteBranch`).

## P2 — Close the confirmed code gaps (parallel worktree lanes)

| Lane | Work | Evidence | Effort |
|------|------|----------|--------|
| A: Meeseeks render | subagentsprites.js ledger folds `task` events but world.js has NO draw code — sub-agents run invisibly. Draw helpers near lead's desk (prune/list/alpha already exist) | world.js:85-91 | 2-3h |
| B: Seed shelf save flow | Seeds.fromCandidate() engine complete but "save this as a seed" affordance never reaches COMMS; wire to chat beat + Recipes.saveCustom() — closes the First Pitch arc | seeds.js, pitch.js:64-90 | 4-6h |
| C: Memory/question overhaul | Locked 2026-06-29 design entirely unbuilt: asked/proposed/rejected ledgers in DossierStore, ignore→stop-forever, discard→denylist, salience-driven ask budget (reuse mint.js detector) | dossierstore.js | 8-10h |
| D: No-op turn refund | Last ref-parity item: refund iterations that produced zero tool calls + no assistant text; `iteration.refunded` event + test/iteration-budget.test.js | loop.js | 4h |
| E: Discord inbound | Gateway WS client for `connectGateway` (transport + normalize + UI card all exist; ingress inert). Remove the "send-only" disclosure once live | discord.transport.js:36-56 | M |
| F: Settings P1 sweep | P1-7 export/import/reset (top gap), P1-6 per-agent model override, P1-8 notification prefs, P1-9 advanced knobs UI, P1-10 memory controls UI | stationui.js | M-L |

Lanes are independent — run as parallel Opus 4.8 worktree lanes per the delegation directive.

## P3 — Beginner zero-to-value + monetization (the strategic misses)

The two audit-confirmed GTM blockers, matching the locked product thesis (resold-AI
headline + BYOK secondary):

1. **Demo/sandbox no-key mode.** Today a fresh install produces ZERO value before a
   provider key. Decision fork for Andrew: (a) starter credits on a house key (thesis-
   aligned, needs billing first), (b) scripted no-LLM demo quest, or (c) free-tier
   OpenRouter model default. Recommendation: (a) after billing lands, (c) as stopgap.
2. **Wire billing.js.** Pure adapter exists (sidecar/billing.js, 150 lines); zero UI.
   Needs: managed-credit injection into loop.js provider path + STORE panel (balance,
   history, purchase) + friendlyerror upsell path on `billing` failures.

## P4 — Release hygiene + ship

| # | Item | Detail |
|---|------|--------|
| P4-1 | Rename debt | ✅ DONE (safe scope, merged 2026-07-02): launch.json names + main.rs user-facing strings. **DEFERRED TO 1.0 (do together, verified risky):** (1) Tauri identifier `ai.skynet.harness` — changes Windows app identity/AppData/updater continuity, needs appdata migrator + updater re-pin; (2) Cargo name `skynet-desktop` — installed exe is `StarNet\skynet-desktop.exe`, passive update shipping a differently-named exe orphans the old one + breaks shortcuts (t0 test proves the naming); (3) `~/Skynet/workspaces` read-forward fallbacks (guarded by desktop-workspace-migration.test) — removable only after installed base migrates. All `SKYNET_*` env/header/localStorage shims stay dual-accept |
| P4-2 | v0.1.3 disposition | Built+signed+staged in release/. Attended playtest (gate 5) then upload (gate 7) — OR skip upload and cut v0.1.4 after P0-P2, one release with the polish in it |
| P4-3 | G5 spectacle | Postcard/clip export (GTM growth engine per thesis). Design + build after P2; 20-30h |
| P4-4 | Full-gate re-run | FULL `npm test` + shoot + golden + live-LLM smoke + fresh-install t0 on the final trunk before cutting the release build |

## Explicitly NOT in scope (audited, deliberately skipped)

- Multi-backend shell (Docker/SSH/Modal), TUI, cluster coordination — power-user/production
  items, off-moat for the beginner thesis. Revisit post-release.
- Desk progress strip "emptiness" — honest by design; fill comes free when workers emit
  progress events.

## Sequencing & status

Recommended order: **P0 → P1 and P2 in parallel → P3 → P4**. P0 is same-day; P1+P2 is the
bulk (roughly a week of parallel lanes); P3 needs Andrew's demo-mode fork decision; P4 ships.

| Phase | Status |
|-------|--------|
| P0 | ✅ DONE 2026-07-02 — Guardian findings vision-checked+dismissed, goldens superseded by newer parallel re-bless, zones.test chained (8b964a7); branch deletions pending Andrew's confirm |
| P1 | ◐ ~70% — MERGED: prop-sprite-templates, hardening-7-8/1-2/3-4, sidecar-watchdog (cron-staylive salvage), memory-cortex ('full' contract fix), work-visibility, meeseeks proof harness. SUPERSEDED (verified in code, delete): quick-model-selector, commission-redux, routine-run-now, starnet-remote-files, 3 memory branches, workstreams-sessions-ui, ui-number-format (re-done fresh), parity-finish (MCP stdio on trunk), starnet-api-gate, starnet-tests-tauri. IN LANE (p1-integration): skill-builder-gap, slash-plan1..5-6, cortex-hermes-plus salvage, hermes-parity-loop verdict |
| P2 | ◐ — A/B/C verified ALREADY SHIPPED (stale audit rows); D turn-refund MERGED (parity 11/11); E Discord full-duplex MERGED; F settings-P1 lane running |
| P3 | ✅ DONE 2026-07-02 — ChatGPT-no-key default funnel + config-gated credits/STORE merged (scripted demo rejected as off-thesis) |
| P4 | ✅ BUILD CUT — v0.1.4 built, signed (pubkey-matched), staged in release/ with manifest (t1/t3/t4/t5 gates all green on the staged artifacts); safe renames merged (risky trio deferred to 1.0, table above); FULL GATES GREEN on final trunk (npm test exit 0, shoot 17/17, GOLDEN PASS). Remaining = Andrew: attended playtest (~10 min, npm start) + upload release/StarNet_0.1.4_x64-setup.exe and release/latest.json to /desktop/ on updates.starnet.app. Deferred lanes: desktop-release-kit+macOS, session_search |

**Branch cleanup remaining (needs Andrew to run or approve by name — permission-gated):**
```
git branch -D agent/starnet-api-gate agent/starnet-tests-tauri agent/quick-model-selector agent/commission-redux agent/workstreams-sessions-ui agent/ui-number-format agent/cron-staylive agent/parity-finish agent/starnet-memory-consent agent/starnet-hardening-5-6-memory-consent agent/starnet-memory-loop agent/routine-run-now agent/starnet-remote-files agent/skill-builder-gap agent/slash-plan1 agent/slash-plan2 agent/slash-plan3 agent/slash-plan4 agent/slash-plan5-6
```
(each verified superseded-or-merged in this session's campaign; worktrees under gen-trees\ for these can go too: `remove-agent-tree.ps1 <name> -DeleteBranch`. KEEP: agent/cortex-hermes-plus — session_search salvage pending; agent/hermes-parity-loop — release-kit/macOS salvage pending.)

Update statuses in place as lanes land; delete this doc when the release ships.
