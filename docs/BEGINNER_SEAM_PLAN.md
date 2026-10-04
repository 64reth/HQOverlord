# Beginner seam plan — "connect my world" (2026-08-22)

**Trigger:** Joshua G (Permaculture Kernow) — vision interview worked, then stalled at
"integrating my emails, website, online course." Diagnosis: StarNet front-loads
capability breadth and makes *connection* a side-quest; a missing connector surfaces
as a bare tool-error string the model narrates (`sidecar/mcp/manager.js:467`), and the
tutorial ends on a generic nudge (`frontend/app/tutorial.js:662`), never on wiring.

**Doctrine:** slight, not transformative. No new windows. Every lane reuses an existing
surface. Truthful telemetry: the app may only say "connected" when the host's own
read-back proves it (see connector read-back lane).

## Lane 1 — `connector_required` at the moment of need  (P0, backend+frontend)
- **Shared contract (additive, owner: cortex-memory):** new event
  `connector_required { runId, connectorId, kind: 'mcp'|'servicekey', reason, toolName }`.
- **Sidecar:** in `sidecar/mcp/manager.js` where "not connected" throws, ALSO emit the
  event (keep the throw — the model still needs to know). Same for servicekey-missing
  paths. The `connectors.list` tool (`sidecar/tools/builtin/connectors.js`) gains a
  `suggestFor(goalText)` so the lead can name the right connector when NO tool call
  happened yet (e.g. "send my newsletter" → gmail / resend).
- **Frontend:** a COMMS chip in the post-run slot (chips are ONE layer — see memory law)
  reading `⇄ CONNECT GMAIL — 2 clicks` → `StationUI.openTerm('connectors')` pre-routed
  to that id via the existing router (`frontend/app/windows/connectors.js:247`). Reuse
  the friendlyerror `OPEN ABILITIES` button style; do not invent a new one.
- **Tests:** `test/connector-required.test.js` (+ fast.list row) proving the event FIRES
  on a missing-connector tool call, and a ratchet that the catch never goes bare.
- **Live proof:** ask "email my notes" with nothing wired; chip appears; click routes.

## Lane 2 — "Connect your world" as the tutorial's last beat  (P0, frontend)
- After `finishUp()` and BEFORE `PitchStore.offerStarter()`: one beat that reads the
  dossier GOALS and offers ≤3 connectors by topic (`topicmatch.js` → catalog tags):
  email → gmail; site → webflow/wix; calendar → google-calendar; docs → google-docs.
  Each is one button into the existing OAuth start. Skippable, one screen, no new window.
- FIRST STEPS already has a `connector` step — mark it done from the read-back, not the
  click.
- **Tests:** extend `test/onboarding.test.js`; `test/coach-dodge.test.js` must still pass.

## Lane 3 — "What can I do right now?"  (P1, frontend)
- `PitchStore.offerStarter()` currently produces ONE move. Make the starter directive
  connector-aware: given the set of CONNECTED ids, emit 3 concrete first tasks that only
  use what's wired (no "send an email" when gmail isn't). Same surface, richer input.
- **Tests:** `test/pitch*.test.js` gain a fixture with {gmail} vs {} connected.

## Lane 4 — Catalog gaps Joshua actually hit  (P1, sidecar)
- No newsletter/course/WordPress connector exists. Add via Composio/Zapier routing
  rather than bespoke servers: catalog entries for **mailchimp, convertkit, wordpress,
  teachable** that resolve to the composio MCP with a preselected app, so the
  "what are you trying to connect?" router has an honest answer. Only list what the
  composio app list verifiably exposes — read it back, don't assume.
- **Tests:** `test/mcp.catalog.test.js` lock the new ids.

## Lane 5 — Joshua as the stranded-user test  (no code)
- Reply: yes to tutorials; ask for an UNCUT 20-min screen recording of connecting
  Gmail + his course platform on the shipped build. Ask his VERSION first
  (stale-report law). That recording is the acceptance test for Lanes 1–2.

## Order / merge
1 and 2 in parallel worktrees (`new-agent-tree.ps1 connector-required`,
`new-agent-tree.ps1 tutorial-connect-beat`); 3 after 1 (needs the connected-set reader);
4 independent. Each: fast gate green, claims re-lock on frontend edits, live proof,
then merge ritual. Do NOT ship a 5-lane mega-merge — land 1, then 2.

## Non-goals
No dashboard, no rewritten tutorial, no abilities-nav collapse (REJECTED lane), no
"connected" badge that isn't backed by a host read.
