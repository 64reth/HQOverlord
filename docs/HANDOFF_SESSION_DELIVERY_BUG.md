# HANDOFF — delegated work invisible in its target session (for the next agent)

Written 2026-07-30 by the outgoing session. Self-contained: everything you need is here or pointed at.
Read `docs/BRAIN.md` first for project orientation, then this.

## The exact user-visible defect (Andrew's live repro, screenshots exist)

1. Andrew had a session named **"business research session"** and a summoned researcher agent
   (**BUSINESS IDEAS RES**) on the crew.
2. He told the lead (NOVA) to have the researcher do research **in that session**.
3. The dispatch ran. The worker completed a three-idea report and saved a real deliverable
   (`ai-business-ideas-report.md` — the saved-file card appeared in **General**, the lead's session).
4. **The "business research session" shows NOTHING.** No worker conversation, no turns. Both agents
   read idle. The lead itself told Andrew: *"The session UI still isn't showing the worker's
   conversation, so that part of the development build is genuinely broken, but the research run and
   deliverable completed."* That statement is accurate.
5. A second screenshot shows a session view that is EMPTY except a stale "rate NOVA's work —
   nailed it / close / missed" chip row. Consistent with a session whose thread never received its fold.

## Architecture you need (all on trunk `feat/harness-backend`, merged today)

- `team.dispatch` (sidecar/tools/builtin/orchestration.js) accepts `session` per worker. It resolves the
  name over the **station bridge** (`resolveSessions`, ~L215) and passes the resolved workstream id into
  `runOnce({ streamId })`, so the **durable record is correct**: `runStore.record({streamId})` and the
  transcript under `/api/transcript?agent=<worker>&stream=<wsId>` really carry the work.
- After a worker completes, `deliverToSession` (same file, ~L262) sends the answer to the PAGE via the
  bridge verb `station.deliver`; the page half (`frontend/app/stationcommands.js`) appends the turns into
  `Workstreams.get(id).history` (APPEND, idempotent by runId) and persists. THAT append is the only thing
  that makes the work VISIBLE in the session UI.
- The bridge (`sidecar/station-bridge.js`) is request/response over the SSE hub with a
  **6-second timeout** (`DEFAULT_TIMEOUT_MS`) and **no retry** (deliberate: a retried side-effect could
  double-post — but deliver is idempotent by runId, so a retry for THIS verb would actually be safe).

## Root cause (high confidence)

**The visible fold is a one-shot 6s window; the durable record has no backfill.** If `station.deliver`
misses — page briefly busy, SSE hiccup, Commander mid-navigation, sidecar under load, or the model
omitted/failed the `session` param so no fold was attempted — the session's `ws.history` stays empty
FOREVER, even though the full conversation sits in the durable transcript under that exact stream id.
Nothing ever reconciles page-visible session history from the durable store for dispatch-targeted
sessions. (Compare `frontend/app/autosessions.js`, which does EXACTLY this healing for `cron-*` streams:
boot backfill + busy reconciliation from `/api/runs` + `/api/transcript`. Dispatch-targeted sessions have
no equivalent.)

Secondary suspects to rule out while you're in there:
- The model may not have passed `session` on the dispatch at all (the tool description tells it to when
  the Commander named one; verify from the run's tool-call args in the transcript). If it didn't, the
  work runs under the lead's stream and no fold is attempted — same visible symptom.
- A failed fold IS reported to the lead on the result row (`sessionNote`), which matches NOVA's
  "genuinely broken" remark — check the dispatch tool result in the lead's transcript for `sessionNote`.

## The fix I would build (verbatim suggestion, your call)

A reconciliation pass, mirroring autosessions' pattern, so the durable truth heals the visible session:
1. When the page OPENS a session (Chat.load / Workstreams.switch) whose `runIds`/history look behind, or
   on boot: fetch `/api/runs?agent=*` rows whose `streamId` equals a real workstream id the page owns,
   and for any run not in `ws.runIds`, fold its turns from `/api/transcript?agent=<agentId>&stream=<wsId>`
   using the same append/attribution shape `station.deliver` uses (sys marker + assistant turn with
   `agentId`). Idempotent by runId — `station.deliver`'s dedup already established the convention.
2. Optionally: let `deliverToSession` retry once (it is idempotent by runId), and/or raise the bridge
   timeout for `station.deliver` specifically.
3. Add the miss path to `test/e2e.dispatch-session.test.js`: complete a worker while NO page listener is
   attached, then attach and prove the session heals from the durable record.

## What is already verified working — do not re-break

- Full gate green on trunk repeatedly today: `npm run test:fast` (465 steps) + `npm run test:http`.
  Always read the LOG, never the exit code; `npm test | tail` hides a red gate.
- Session-targeted dispatch end-to-end vs a real sidecar: `test/e2e.dispatch-session.test.js`
  (durable ledger + transcript assertions, refusal on unknown names).
- Page verbs against the real Workstreams store: `test/station-commands.test.js` (92 asserts).
- Session tools + capability declaration: `test/station-tools.test.js`. ⛔ The capability registry
  (`sidecar/capability/registry.js`) is an ALLOWLIST — registering a tool without declaring it there
  exposes it to nobody, and only a live model probe catches it.
- Live voice: call BOUND to its opening session (`voice-live.js` bindSession/ensureBoundFocus); NO
  clickable prompts render during a call (`chat.js liveVoiceCall()` gates `choices()` and
  `briefReadCard()`); the only spoken wait is an approval; `session.peek` gives the agent eyes into other
  sessions (peek-first rule in the [ORCHESTRATION] briefing in `sidecar/index.js`).
- Voice identity on installed builds: `local:true` TTS maps the picked voice onto the Edge floor when the
  Kokoro engine is absent (`sidecar/local-voice.js edgeVoiceFor`, `handleTts serveEdge`) — never the
  keyed provider chain. Kill-switch `STARNET_LOCAL_VOICE=0` reproduces the installed shape.

## Protocol (non-negotiable, from CLAUDE.md + hard-won today)

- Work in a worktree under `%USERPROFILE%\gen-trees\` on an `agent/<name>` branch. NEVER feature-edit the
  integration tree (`Desktop\gen`). The integration tree is LIVE with other sessions: commit with
  explicit pathspecs only (`git commit -- <path>`), never bare / never `git add -A`.
- `shared/events.js` / `shared/schema.js` are owned, additive-only. (This bug needs NO contract change.)
- `frontend/**` changes must be mirrored to `website/app/app/**` (`test/website-app-sync.test.js`).
- Any change to files in the claims surface owes a re-lock: regenerate via
  `node scripts/qa/product-perfect/claims.mjs --refresh-surface`, replace `releaseSurface` in
  `qa/product-perfect/claims.json`, commit it as its OWN commit AFTER the code commit (the lock reads the
  COMMIT). On a claims merge conflict: complete the merge, regenerate, re-lock again.
- Green `test:fast` before merging to trunk; `test:http` too if `sidecar/` changed. Merge no-ff from the
  integration tree; write the merge message yourself. Commits carry the human author only — no
  Co-Authored-By trailers.
- Dev server for live verification: `SKYNET_PORT=<port> SKYNET_DEFAULT_MODEL=<id> node dev/seed.js --keep`
  (key comes from `dev/.env.dev`). Andrew's current test server is :8797 (integration tree). 8796 was the
  outgoing session's acceptance station (worktree `gen-trees/voice-bundle-models`).

## Still open beyond this bug

- `station.report` (the "tell me when it's done" voice verb) — unbuilt; background dispatch +
  `team.subagents` cover it.
- The full spoken round-trip has never been verified with a real microphone (browser-pane harnesses
  cannot grant one). The mechanics are tested; the assembled call needs human ears.
- v0.8.0 cut: trunk is cut-ready per qa/STATUS.md; version lives in FOUR files (`package-lock.json`
  twice) and `release-cut.mjs` bumps nothing.
