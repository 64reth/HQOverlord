# HANDOFF — Telegram must have FULL capability parity with the StarNet desktop app

**Status: NOTHING BUILT. No files were modified.** This session was read-only (Read/Grep only).
Everything below is code-grounded investigation + a proposed design. The design is **unverified** —
treat it as a starting hypothesis, re-grep before trusting any line number.

Repo: `C:\Users\andro\Desktop\gen`, trunk `feat/harness-backend`.
Date of investigation: 2026-07-31. Trunk moves hourly — **re-verify every reference below.**

---

## 1. The order

Andrew's requirement, verbatim in intent: **a user must be able to do ANYTHING from Telegram that
they can do inside StarNet.** Equal capability. The reference product is Hermes, whose Telegram
adapter gives the agent full access (shell included) because an owner DM *is* the owner.

This is a **product decision already made by Andrew.** It is not open for re-litigation by the
implementing agent. Do not "compromise" it back into an opt-in toggle — he explicitly rejected
that. Default ON.

## 2. What is actually broken today (verified by reading trunk)

A Telegram-triggered run is classified `surface: 'autonomous'` and is therefore denied:

| Denied today on Telegram | Where |
| --- | --- |
| `shell.exec`, `verify.run` (WORKSPACE_PROCESS) | `sidecar/inputpolicy.js:120` + `:167` |
| Spotify / jukebox (MEDIA_CONTROL) | `sidecar/inputpolicy.js:117` + `:164` |
| MCP connector tools (EXTERNAL_UNKNOWN) | `sidecar/inputpolicy.js:113-115`, `:132-135` |
| ungranted mutations (fs writes etc.) — consent broker default-denies, "silence is not consent" | `sidecar/index.js:~10947` (`makeConsentBroker`) |
| the WORKBENCH **object itself** is absent from the headless office, so shell tools never even project | `sidecar/capability/office.js:21-30` (`fullOffice()` has computer/dish/cabinet/notebook/studio/jukebox — no workbench) |

**There are TWO independent gates.** Fixing one alone does nothing:
- **Object half** — `resolveTools` projects tools only from objects in the room. No WORKBENCH object ⇒ no `shell.exec` in the tool list at all.
- **Authority half** — `enforceRunAuthority` / `makeRunAuthority` strips workspace-process tools on any non-interactive surface.
- (**Third half, easy to miss**) — the **consent broker** must also say yes, or you ship the incoherent state where a tool is offered and then refused. See `terminalGrant` / `connectorGrant` at `sidecar/index.js:10979` and `:10982`.

### The existing grant mechanism (reuse it, don't reinvent)
`unattendedGrants: ['workbench','connectors']` already exists (built 2026-07-25) and wires all three
halves correctly:
- normalized/allowlisted: `sidecar/inputpolicy.js:67` (`GRANTABLE_UNATTENDED`), `:75` (`normalizeUnattendedGrants`)
- object half: `sidecar/index.js:10894` (`stationWithObject(station, agentId, 'workbench')`) and `:10899` (`stationWithConnectors`)
- authority half: `sidecar/inputpolicy.js:100-102, 120, 167`
- consent half: `sidecar/index.js:10979, 10982`
- durable source: cron job records — `sidecar/cron-store.js:60,169,209`, driver `sidecar/cron-driver.js:293`

**It is reachable ONLY from a routine (the ROUTINES panel tick).** `sidecar/channels/hub.js` never
passes `unattendedGrants` to `runOnce` — see the runOnce call at `sidecar/channels/hub.js:1436-1455`.
That is the whole reason Telegram has no shell.

### Two traps already known
- `/approvals on` flips the channel run to `surface:'interactive'` (`hub.js:1439`) but ALSO sets
  `floorless:true` (`hub.js:1444`) — so the office is still the headless `fullOffice()`, which has no
  WORKBENCH. **Turning approvals on does not grant shell.** Don't be fooled into thinking it does.
- `floorless` vs `surface` are deliberately separate meanings — read the comment block at
  `sidecar/index.js:10877-10886` before touching either. A previous regression cut Telegram from 59
  tools to 2 by conflating them.

## 3. Proposed design (UNBUILT — my proposal, judge it yourself)

Add ONE explicit concept: **`ownerTrusted`** — "this run was initiated by the Commander in person,
in a chat only they can reach, so it carries the same authority as sitting at the desktop."

Set by exactly one caller (`channels/hub.js`), so the blast radius is auditable and cron / night
shift / delegated workers are byte-identical.

1. **`sidecar/channels/hub.js`** — pass `ownerTrusted: true` into `runOnce` (the call at ~`:1436`;
   check the second runOnce at ~`:1508` too and decide deliberately).
   - ⚠ **Gate it on the sender actually being the owner.** A DM is owner-only by construction
     (`sidecar/channels/adapter.js:270`), but a **whitelisted group is not** — a group message never
     calls `ownerOk()` (see the comment at `adapter.js:313-318`). Handing shell to every member of a
     whitelisted group is almost certainly not what Andrew means. The inbound message already carries
     `chatType` and `userId` (`adapter.js:280-289`); the adapter knows `owner`
     (`adapter.js:557 _internals.owner`). **Confirm this with Andrew** — it is the one genuine
     product fork in this lane.
2. **`sidecar/inputpolicy.js`** — `makeRunAuthority({ ..., ownerTrusted })`. Treat an owner-trusted
   run as watched in `project()` and `authorize()` for WORKSPACE_PROCESS, MEDIA_CONTROL, and
   EXTERNAL_UNKNOWN. Keep PHYSICAL_INPUT / VISIBLE_DESKTOP denied — `computer.use` / `desktop.open`
   are stripped unconditionally on every surface (`enforceSyntheticOnly`) and that is a separate lane.
3. **`sidecar/index.js` runOnce** — read `o.ownerTrusted`; add the WORKBENCH object via the existing
   `stationWithObject` (needed for the bay-docked case too, where an explicit `station` bypasses
   `composeOffice`); make `terminalGrant`/`connectorGrant` true for it.
4. **Consent broker** (`index.js:~10947`) — with approvals OFF there is no one to click, so an
   owner-trusted run must not default-deny; with approvals ON, keep asking in-chat. Roughly
   `bypass: FULL_ACCESS || agentFullAccess || (ownerTrusted && !prompt)`. **The hardline floor must
   still apply.**
5. **TAINT — the real decision.** `index.js:11292-11299` revokes shell/connectors for the rest of a
   run once untrusted content (a fetched webpage) enters context, but only when
   `surface !== 'interactive'`. Left as-is, **Telegram shell dies the moment the agent does a web
   search** — that is not parity and will read as broken. Exempting owner-trusted runs matches the
   desktop exactly. **This is the actual security trade Andrew is buying; state it plainly to him,
   then do what he says.**
6. **Truthful-telemetry follow-through (mandatory, this project's core law):**
   - `/tools` over Telegram computes `placed` from the autonomous office at `index.js:9875` — it will
     under-report unless updated, and the stale comment at `index.js:9784-9790` explicitly claims
     "a placed WORKBENCH still grants no terminal over Telegram". **Rewrite that comment.**
   - `sidecar/capability/capsummary.js` prints an "This is an UNATTENDED run … unavailable" note
     (`:86-90`). On an owner-trusted run that prose becomes a lie. Pass `ownerTrusted` through
     (call site: `index.js:11661`) and give it honest prose.

## 4. Gates and verification owed

- `npm run test:fast` AND `npm run test:http`. **Read the LOG, not the exit code** (`npm test > log; echo $?` reports the ECHO's status).
- Existing suites that lock this behavior and WILL need updating deliberately (not silently):
  `test/inputpolicy.test.js`, `test/capsummary.test.js`, `test/tool-withheld-message.test.js`,
  `test/class-loadouts.test.js`, `test/station-tools.test.js`.
- **Live proof is required, not optional** (`starnet-verify`): message a real bot, run a real command
  from Telegram, see real output. The inbound half of Telegram has historically only ever been
  fake-proven — see the memory lane `telegram-hermes-parity-lane`, law: *"a fixture you wrote yourself
  only proves the code matches itself."*
- Claims re-lock: previous Telegram lanes owed none (`releaseSurface.files[]` contains no
  `sidecar/channels/*`), but this lane touches `sidecar/index.js` and `sidecar/inputpolicy.js` —
  **re-read the array, don't assume.**
- Protocol: work in a worktree (`gen-trees\new-agent-tree.ps1 <name>`), pathspec commits only, no
  `Co-Authored-By` trailers.

## 5. Context the next agent should read first

- `docs/BRAIN.md`, then the mandatory skills in `.claude/skills/` (`starnet-task-doctrine`,
  `starnet-backend-law`, `starnet-verify`).
- `docs/TELEGRAM_PARITY_PLAN.md` — the existing Hermes-parity program (§4.5 state of play).
- Memory lane `telegram-hermes-parity-lane` — 30+ hard-won laws about this exact surface.
