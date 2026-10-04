# UI/UX FINALE AUDIT — 2026-07-09

The pre-desktop-release polish audit Andrew asked for: "find every poor UX and UI choice we
have made." Produced by 7 parallel read-only code audits (OVERSEER creation, COMMS,
Recruitment Bay, CHANNELS, cross-cutting consistency, window manager/chrome, WORK+BUILD
surfaces) cross-checked against 18 live screenshots (`.uishots/` — the 16 dock states plus a
fresh-first-boot capture of splash + CREATE YOUR OVERSEER taken with an unseeded sidecar).

**Verdict: ~120 distinct findings.** The bones are good — the window chrome, the beat system,
the truthfulness engineering, and the marketplace-era card language are premium. The rot is
concentrated in (1) browser-native controls puncturing the CRT aesthetic, (2) three surfaces
still wearing a previous UI generation (genesis BRAIN column, COMMS cards, CHANNELS cards),
(3) a handful of honest-to-goodness truth violations, and (4) primitive sprawl (15 button
families, 8 close buttons, 8 bespoke arm-confirms, 12 empty-state classes).

Nothing here has been fixed yet. This doc is the source of truth for the sprint lanes below.
Every finding carries file:line evidence from trunk as of 2026-07-09 — re-grep before
building; this repo's audits go stale in hours.

---

## RELEASE BLOCKERS (P0)

1. **Genesis model list is a raw native `<datalist>`** — unstyleable OS dropdown on the very
   first screen; ~370 models rendered flat, alphabetical by raw slug, ids only (catalog `name`
   discarded). `index.html:174-175`, `app.js:1074-1075`, sort at `harness.js:309`.
2. **Genesis default-model autofill contradicts the curated picks** — regex over the
   alphabetical list lands on stale models (`app.js:1078`) while MODEL_PICKS renders the right
   answer one inch below.
3. **COMMS composer silently truncates at 500 chars** (`index.html:364` maxlength) — data loss
   on the app's primary input.
4. **COMMS replayed history fabricates timestamps** — all history rows re-stamped with the
   current clock on reload/switch (`chat.js:806, 3131, 3137`), violating the module's own rule
   (`chat.js:303-306`) and truthful telemetry.
5. **COMMS approval prompts steal keyboard focus mid-typing** (`chat.js:1413-1414`) — next
   Enter can approve a file write the user never read.
6. **Recruit SUMMON breaks its stated promise** — CTA says "opens its own chat thread"
   (`marketplace.js:623`) but the bay closes with only a toast (`app.js:735-736, 762`). The
   flow's climax produces no visible result.
7. **Recruit narrow-viewport stranded state** — `.show-dossier` never removed; under 820px the
   roster is `display:none` with no back control (`marketplace.js:1019`,
   `marketplace.css:522-523`).
8. **CHANNELS success messages render in the error color** — `.msg` defaults to `--bad`
   (`app.css:235`); `buildMessaging` never toggles `.ok`, so "✓ connected" paints red
   (`stationui.js:3652, 3671, 3679`).
9. **CHANNELS asserts CONNECTED before any transport proof** on telegram/slack/matrix/signal —
   sidecar sets `{connected:true,state:'up'}` optimistically (`sidecar/index.js:3532, 3813`,
   POSTs at `7481, 7679`); the "✓ connected" line never corrects itself. Discord (gateway
   READY) is the correct pattern (`stationui.js:3593-3599`).
10. **Esc destroys unsaved drafts in any window** — window-level Esc closes from any focused
    element including open CONFIG/memory/belief editors; `closeTerm` has no dirty guard
    (`stationui.js:449-450, 310`).
11. **ROUTINES ▶ RUN NOW streams output into a hidden pane** — `#rt-out` is CREATE-section
    markup while the button lives in ACTIVE (`stationui.js:4291` vs `4257`;
    `.con-sec-hidden` `app.css:2610`) — a real paid run whose result the user never sees.
12. **tutorial.css is off-system** — ~37 hardcoded amber/green colors on the FIRST-RUN surface
    (coachmarks, briefing, field manual); breaks wholesale on every non-default theme
    (`tutorial.css:44-45, 63-76, 138-179`).
13. **Toast layering is wrong in both directions** — `#toast-stack` z:960 is buried under the
    Recruitment Bay overlay z:9000 (`motion.css:139` vs `marketplace.css:7`) AND parks on top
    of the COMMS composer's mic/model cluster, stealing clicks for 4-6s per toast
    (`motion.css:138-142`, confirmed in ingame.png). *(Live-confirm the burial before fixing.)*

---

## LANE PLAN

Each lane is one agent worktree, independently mergeable. **Lane F1 lands first** — it ships
the primitives (custom dropdown, z-scale tokens) the other lanes consume.

### LANE F1 — Foundation primitives (BLOCKS: A, D, G partially)
- Custom dropdown primitive replacing all 10 native `<select>`s (4 skins today):
  `index.html:346` (COMMS agent line), `modelpicker.js:28,33`, `stationui.js:2942,2957-2959`
  (settings fallback/tier ×4), `marketplace.js:1365,1608,1609`. Build the closed state as one
  shared class; open state = the already-themed model-dock popover vocabulary
  (`app.css:~920-1050`) / `.ws-menu` (`app.css:1829`). Keep `<select>` semantics for a11y
  (appearance:none + phosphor chevron) or promote to a real CRT listbox popover — decide once,
  apply everywhere.
- Z-scale tokens `--z-window/--z-glass/--z-toast/--z-overlay/--z-tutorial` (today z spans
  1→99000 across 9 files) + raise `#toast-stack` above `.mkt`; move the stack out of the
  composer corner (see fork Q2).
- Custom checkbox scope: motion.css:175-212 covers only `.set-row` — re-scope so
  `marketplace.js:386` and the stock-browser checkbox at `marketplace.js:1558` inherit.
- Kill native number spinners app-wide (9 spots: `stationui.js:986, 2704, 2920-2926, 3770`,
  `build.js:606`).

### LANE A — GENESIS (CREATE YOUR OVERSEER)
P0s #1, #2 above, plus:
- Provider row: 15 equal-weight ALL-CAPS chips crammed in the narrow column
  (`index.html:131-150`) — recommended path (CHATGPT — NO KEY) gets hero treatment
  (`ov-card` language), rest become a compact secondary grid.
- Rebuild the model field as a themed, grouped, searchable popover reusing ModelDock parts
  (`renderList` modeldock.js:410, `openRouterGroupName` :232, `modelLabel` :158); keep
  `#in-model`/`#model-list` ids — all genesis ids are load-bearing (see HTML comments
  `index.html:50-56`).
- Add pricing to the hint + rows ($/M via `Harness.priceOf` — currently unused at genesis;
  `updateHint` app.js:1242-1249 shows ctx only).
- Brain box progressive disclosure (only active provider's controls; byok-note collapsed)
  (`index.html:129-179`).
- WAKE: one-shot latch + WAKING state (double-click double-runs `enterGame`, `onWake`
  app.js:1631); optional honest credential ping — never block entry (sandbox law).
- Boot flash: `#screen-connect` ships `class="screen active"` statically (`index.html:57`) so
  returning users flash the CREATE console before reroute (`app.js:2874-2970`) — boot veil.
  VERIFY LIVE first.
- Initial focus `#in-name` (fresh) / key field (resume); today Tab starts at phosphor swatches.
- RESUME "‹ BACK" actually re-runs auto-resume (`app.js:1600-1605`) — relabel.
- "custom model slug" hint conflates typo/custom/catalog-offline (`app.js:1248`) — split.
- P2 batch: aria-pressed on `.prov`/`.skin-thumb`; `<label for>` associations; "＋ 9 MORE"
  hardcoded count (`index.html:149`); default skin named "Blank" buried 10th + 5 near-identical
  recolors (`data-shim.js:31,38`); delete dead CSS generations (`.cc-grid/.cc-col-*/.cc-emblem/
  .cc-ascii/.cc-stamp` app.css:164-211, `.archetype-*` 1314-1329, `.adv-toggle` 243-253,
  `.dial-*/.voice-traits` 1339+, `.skin-section/.skin-stage(-frame)`); "● REC" asserts a fake
  recording (`index.html:45,63`) → "● LIVE"/"● LOCAL"; "(370 available)" → "(370 in catalog)".

### LANE B — COMMS flow correctness
P0s #3, #4, #5, plus:
- Send button — Enter is currently the only send path (`index.html:366-391`); themed ⏎ chip.
- Typo'd slash commands become paid model turns (`chat.js:466-468, 4207-4212`) — local
  "unknown command" line instead.
- In-flight attachments silently dropped on send (`chat.js:596-601`) — hold send or notify.
- Error recovery chips are wiped by `load()` (`chat.js:3287-3320, 694`) — re-offer in
  `renderHistory` when the trailing turn is `error:true` (stranded-user law).
- Live-run continuity across stream switches (pairs with C: structured tool events).
- P2: /help + palette hide the command surface (group by the existing `category` field,
  `chat.js:4095-4099, 4147-4189`); empty-state starter chips via `choices()` (fork Q4);
  attachment accept-filter vs drag-drop mismatch + can-model-see badge (`index.html:359` vs
  `chat.js:508-516`, `fileKind` 494-497); persistent "↓ latest" when unstuck (113-132); ctx
  warn/crit tint near composer (truthful, known-state only); /history floods 31 rows
  (3757-3770) → collapsible card; ARIA (role=log on #chat-log, aria-activedescendant on slash
  listbox, aria-expanded onto the `.tc-head` button).

### LANE C — COMMS visual uplift (to marketplace-era language)
- Unify tool rendering: live chips vs replay's dim `toolLine` text (`chat.js:3152, 946-954`) —
  store structured tool events in Channels, render chips on replay.
- De-dupe the post-run pile: inline made/saved rows + per-file toast + recap card + resolved
  presence all repeat the same artifacts (`chat.js:4449-4462, 4461, 1260-1295, 250-258`) —
  recap becomes the single ledger.
- Minimal terminal-markdown pass (bold/inline-code/fence → phosphor spans, textContent-safe)
  or plain-text directive with worked example (`renderProse` chat.js:338-342) — fork Q3.
- Emoji purge in COMMS (`chat.js:1105, 1128, 3308, 570, 857, 1527-1529, 3681`) → themed
  glyphs/currentColor SVG (paperclip at `index.html:371` is the model).
- P2: chip expand affordance (`comms.css:140` empty rule); "new messages ↓" pill anchored to
  `#chat-log` not the panel (`comms.css:214` vs two-row composer); delete dead
  `.cmsg.agent.reply` styling + stale comments (`app.css:412-424, 355-360`; `comms.css:75`) or
  deliberately re-apply; `.no-anim` during renderHistory (up to 120 simultaneous entrance
  anims, `comms.css:79-86`); day separators + stamp on newest row of a group (53-54); render
  the trim marker (`chat.js:733-742` vs 3130); route all spend through `U.usd`
  (3652-3653, 3807-3808); label idbar pin vs dock active model (631-639 vs
  modeldock.js:573-592); SYSTEM register for command output instead of agent-attributed
  `localLine` (863); min-width on short user cards (app.css:400).

### LANE D — Recruitment Bay revamp
P0s #6, #7, plus:
- Land the summon: pass `{activate:true}` (or focus+highlight the new rail entry) and route
  the desk-placement chip through the non-activate path too (`app.js:749-762`).
- Reorder: recommended + CLASS ROSTER first; APPEARANCE/MODEL compress into a config strip —
  today the primary decision starts at ~80% page height.
- Restyle ModelPicker + effort via the Lane-F1 primitive (keep its plumbing — one catalog,
  provider|id values, effort clamping).
- Dossier declutter (360px pane, nine stacked blocks): drop one-hot FOCUS LANES bars
  (`marketplace.js:644` vs 646), gear state → ●/○ chips + single footnote (548 vs 550-552),
  STANDING ORDERS behind a disclosure; mini commit-summary row (skin + model + effort + class)
  above the CTA; re-render spec grid on model-bar change showing effective resolution
  (629-635 vs app.js:685-689).
- Effort-without-model silently discarded (`marketplace.js:1056-1058`) — carry
  `{model:'', effort}` or disable with hint.
- Copy: kill stale "pre-fills the wake screen" hint (388); WHY chips name the matched goal
  keyword instead of ×3 boilerplate (822, `specGoalScore` knows).
- Search/filter should collapse the shelves like the RECIPES tab does (389-394 vs 906, 958);
  MINE chip + customs pinned above catalog (300-307, 405-409); Esc in form views = back/arm
  discard, not bay-close (251-253); DEPLOY re-spec gets arm/confirm (1132-1139).
- Visual: bottom fade mask on roster clip (marketplace.css:110); ONE section-header component
  (three heading systems: 445 vs 255 vs 381/386 — gold reserved for earned); appearance grid
  row-height cap (449-451) + stage caption "LIVE PREVIEW — <name>"; entrance anim only on open
  (145-147); roving tabindex + focus restore; search placeholder per tab (195) + match codes/
  purpose (362); filter counts include customs (301-303); adopt-voice checkbox moves beside its
  CTA (386 vs 1123-1124); translator seal SVG `<text>` → paths (classicons.js:48); footer
  legend per tab + "LOCAL REGISTRY · 0 BYTES OFF-MACHINE" hardcode watch item
  (marketplace.js:200-203).
- KEEP WHOLESALE: coin seals, two-pane + paintDossierAccent, the entire truthfulness stack
  (warm-gated recruiter, honest cold states, WHY-from-counters, prospect validation), live
  SkinStage, dialog focus discipline, unified recipe editor.

### LANE E — CHANNELS honesty + catalog grammar (touches sidecar — backend law, additive)
P0s #8, #9, plus:
- Hide DISCONNECT unless connected/configured; CONNECT→RESUME when saved-but-offline
  (`stationui.js:3577-3580`).
- Card grammar: per-platform accent strip + coin plate glyph + hover/entrance (style.css:921 vs
  marketplace.css:135-166); keep the `.on` green glow. Dedicated `.ch-lbl`/`.ch-title` — stop
  reusing `.ms-h` (stray ◆ + divider dressing, style.css:834-842).
- Agent binding: use the SELECTED agent consistently (`agentIdentity()` 3631-3635 mixes
  present[0] prompt with active-stream agentId); show "ANSWERS AS: <name>" on connected cards
  (add agentName to `channelStatusPayload`, sidecar/index.js:7610-7631).
- Armed FORGET purging record + keychain (no path today, 7505); naming: footer plate prints
  "MESSAGING" under the CHANNELS title (stationui.js:411-415), dock subtitle stale
  (index.html:434); error copy names the removed "title screen" (3650, 7478, 7675) — recopy +
  Settings deep-link door (openTerm 5161-5171).
- P2: CONNECT in-flight state (3638-3677); armed disconnect + no "disconnected" lie when idle
  (3678-3682); "•••• saved" placeholder when configured (3599); 30s re-poll while open
  (3620-3628); notify opt-in silent failure + zero-channel no-op hint (3693); matrix/signal
  URL-shape validation + auto-https (3533, 7669-7673); ADVANCED chip on Signal; render
  ownerLocked (7624); setup guides → `<ol>` (3504-3508); reword the "PING ME WHEN I WORK ON MY
  OWN" interleaved label (3564); lift the headless promise out of opacity .55 (style.css:914);
  state classes not inline color (3595).
- KEEP: single CHANNEL_CATALOG architecture, secret hygiene (DOM clear, keychain park + honest
  fallback), boot auto-resume, identity sync fan-out, Slack order-tolerant tokens.

### LANE G — Window manager + chrome + CREW/SYSTEM windows
P0 #10, plus:
- Dock click on a buried window should RAISE it, not close it (`toggleTerm` stationui.js:350-352).
- Focus: fresh windows focus the minimize button (472-473) → focus window/first body control;
  Esc only works when focus is inside the window (449 + 420) → focus on mousedown or
  document-level Esc-topmost; rename Esc double-fires (1337, missing stopPropagation);
  minimize handoff focuses a hidden popover item (279-281).
- AGENTS window: BRIEF "RUNS" stat is station totals wearing an agent label (810-822) — per-
  agent truth or relabel; search glyph swallows placeholder first char (app.css:2534-2543,
  visible in two screenshots — verify + pad); HAB-01 hardcoded ×3 (678, 801, 1499) — derive
  from world state; DANGER block off the landing tab (829, 855-860); dup disabled-delete
  reason (851-852); skin listbox semantics (857, 842).
- REWIND: bound to dossier's last-selected agent with raw id in title (4462-4464) — name +
  switcher; consequence-stating confirm ("removes N files since <time>", 4495-4499); refresh
  affordance (4504).
- LOGBOOK: agent-scoped but never says so (4513, 4570, 4601 vs "the station's event record"
  dock copy) — name agent + switcher; INSIGHTS leaks raw enum keys (4548, LB_REASON at 4511
  unused there); row-click vs text-selection (4575).
- SETTINGS: mojibake `â€”`/`Â·` in the Ollama row (2186-2188 — the only mojibake in the
  frontend); CLEAR NOTIFICATIONS buried in SYSTEM›STATION DATA with no success feedback
  (3020-3021, 3260-3265); "SCHEDULED TASKS" header holds only keep-awake (2981-2982); AUTONOMY
  secretly holds three subsystems incl. the PERMISSIONS ledger (2863-2912) — split rail items;
  TERMINAL AUDIO under DISPLAY (2967-2969); provider card role=button wrapping an ADD KEY
  button (2111-2126); duplicated PROVIDERS heading (visible in sys-settings.png); one
  persistence model (SAVE+msg vs instant, 2672).
- COMMANDER: 560px scroll with guillotined bottom edge — sections/jump links + fade cue
  (4646-4722); familiarity gauge vs gate provenance (4657-4663).
- Topbar/dock: STANDBY paints full signal bars beside an ONLINE pill (`topbar.js:56-59`,
  `stationui.js:106-110`) — dim neutral bars pre-bridge; RECRUIT carries the "workstream"
  glossary hint (`index.html:413`); RESTORE/LOGBOOK dock copy misdescribes scope
  (`index.html:444-445`); NOTIFS label vs LABEL LAW (398-400); ArrowLeft/Right across dock
  groups (navdock.js:86-103).
- NOTIFS: date on non-today rows (82 vs 60-entry persistence 3293-3294); rows inert (no
  click-through/per-item dismiss); copy voice drift.
- friendlyerror/settings emoji → CRT glyphs (`friendlyerror.js:290-311`, `stationui.js:3015`);
  "🛒 Open STORE" mislabels the PROVIDERS door (309). Glossary gaps: SLAG, KUDOS, LEASH,
  E-STOP, restore point, uplink (glossary.js:19-44).
- P2 window-manager batch: per-window user resize (fork Q5); persist termPos/consoleSection;
  re-clamp on browser resize (fitTermInViewport dead at 171/468); aria-modal lie (371);
  pointer-events for touch drag (124-145); cascade counts minimized windows (153); chip ✕
  (235).
- "on station since" fixture date renders as truth — dev-seed only; ignore.

### LANE H — WORK+BUILD surfaces
P0 #11 (ROUTINES rt-out), plus:
- ROUTINES honesty: create-confirm says "scheduled" while the scheduler is disarmed
  (stationui.js:4446) — consume `AutoJobs.armStateLine()` (autojobs.js:207-220, built for
  exactly this); promote the disarmed state from a one-line whisper (4307-4309) to the
  `.brief-block` banner. (Quest APPROVE at 5038-5040 already does this right — copy it.)
- SKILLS: locked cards at opacity .34 + 10px dim text are illegible (style.css:844,
  app.css:1541) → ~.6-.7; make locked cards clickable → `placeGearForSkill(s.cap)` (1633,
  today only wired to the library's → PLACE, 1745-1747); "1 live right now" reads "I live"
  (1571); search-glyph/padding audit across consoles (app.css:2534-2541).
- TASK BOARD: delete the `.kb-empty-col` 0.4 opacity wrapper ghosting even the +ADD ONE CTA
  (app.css:1529); assign toast names present[0] not the stream's agent (1887); title clamp
  160→80 mismatch (1933/1859 vs workstreams.js:51); cursor:pointer + button semantics on cards
  (style.css:812, 1961); agent chip + deliverables count on cards (1916-1928; data at
  workstreams.js:245-249).
- CONNECTORS: delete the duplicated intro paragraph (3789 vs 3780-3783); category counts
  jammed inside the `.sec-r` divider rule → `.sec-tag` (4058-4059; same misuse at 1731);
  ⚡🔑🔒 emoji chips → glyphs (4032).
- QUESTS: migrate inline-style rows to the shared card vocabulary (4945-5016).
- Delete warroom's dead approval-hotspot subsystem (~55 lines, warroom.js:22-77).
- REFIT first-use guide: 9-paragraph wall (build.js showGuide) → 3 beats + "more in MANUAL".

### LANE F2 — Design-system hygiene (mechanical, after F1)
- Button consolidation: ~15 families → one `.btn` base + modifiers; convert motion.css's
  interactive-class whitelist (31-37, 588) to shared selectors so every future button inherits
  hover-bloom/reduced-motion by default.
- One `.x-btn` close primitive (8 implementations today; `.term-x` stays as the window
  instance; `.tut-brief-x` hardcodes #9fb0a4).
- ArmConfirm migration: 8+ bespoke copies → armconfirm.js everywhere (app.js:2447-2451,
  2657-2661; marketplace.js:1206-1208, 1233-1235; stationui.js:2290-2298, 3243, 3262-3264,
  4399, 4495); one `.armed` rule (5 re-declarations); one label voice + one disarm timeout.
- Empty-state consolidation: 12+ one-off classes → `.empty-state` (+small variant):
  .fb-empty, .up-empty, .mkt-empty, .mkt-dos-empty, .key-empty, .proj-empty, .mc-empty,
  .cd-empty, .cmsg-empty, .model-dock-empty, .kb-empty-col, .sk-loading, .wg-pop-none.
- tutorial.css tokenization (P0 #12).
- Type sweep: 627 raw font-size px vs 20 token usages; kill sub-11px VT323 (8/9/10px sites
  listed in the consistency report) and 31 faux-bold declarations (single-weight font →
  --ph-bright + letter-spacing emphasis).
- Token hygiene batch: `--ph-bg` undefined (app.css:755 → --ink); CSS named `gold`
  (style.css:909-910); `--link-down` token for #ff6a4c (app.css:1423,1920); strip divergent
  dead fallbacks; global `button:disabled` rule; delete 17 redundant per-container scrollbar
  blocks; bezel top-edge highlights → var(--ph-bright-rgb) (C6); loading-microcopy voice
  (lowercase + …).

---

## OPEN FORKS — Andrew decides

- **Q1 Composer cap**: remove maxlength entirely vs raise (e.g. 4000) + live counter.
- **Q2 Toast home**: bottom-left over the stage vs directly above the composer (out of the
  mic/model cluster either way).
- **Q3 Transcript markdown**: render a minimal terminal-markdown subset vs enforce plain text
  via prompt directive (needs a worked example per the format-directive law).
- **Q4 COMMS empty-state starter chips**: yes (2-3 tappable recipe/`what can you do` chips) or
  keep the bare eerie line.
- **Q5 Window resize**: add per-window drag-resize (COMMS already has one) or keep fixed sizes
  this release.
- **Q6 Genesis provider hero**: is "Sign in with ChatGPT" THE blessed first path (hero card),
  or should OpenRouter share top billing?

## NEEDS LIVE CONFIRM BEFORE FIXING
- Toast-under-RECRUITMENT burial (B4) — 30-second repro.
- Recipe-editor stock checkbox (marketplace.js:1558) — screenshot it.
- Boot flash of the CREATE console for returning users (Lane A) — measure real duration.
- Search-glyph placeholder overlap (two screenshots show it; the CSS says it shouldn't).

## DO-NOT-BREAK LEDGER (aggregated from all 7 reports)
- Genesis: every functional id (`index.html:50-56` comment block) is load-bearing app.js
  wiring. VT323 is the house DOM font by design.
- COMMS: beat arbiter + arm-delay precedence, vanish() contract, gold-inset .turnin family,
  .nudge register, defer-never-starve loops, presence/recap truth derivation, fileBlobUrl law,
  per-stream Channels isolation, XSS-safe linkify, consent Esc=deny, reduced-motion blocks.
- Recruit: coin seals, truthfulness stack (warm gates, honest cold states, prospect
  validation), SkinStage, ModelPicker plumbing, focus-trap discipline.
- CHANNELS: single CHANNEL_CATALOG, secret hygiene, boot auto-resume, identity fan-out.
- Chrome: makeTerm CRT animations + reduced-motion, drag clamping, closeTerm focus return,
  mountConsole search/tablist model, mode exclusivity (panels close REFIT), honest empty/
  offline states, linkDown truth seams, navdock a11y, friendlyerror kind→door architecture.
- WORK/BUILD: board stateChip gating on Channels.isBusy, server-math next-fire, scout/FOR-YOU
  honest cold starts, connector state:'up' truth, widgets stale-flip, skills two-axis law,
  AutoSessions honesty, recipe fork provenance + validateImport.
