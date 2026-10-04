# Cron Visibility Integration Plan

> Purpose: make scheduled routines understandable to the user before, during, and after they run. A cron job should never feel like a hidden background daemon. The user should be able to answer: what is scheduled, what is working now, what finished while I was away, and what result did it produce?

---

## 1. Current State

This plan starts from the current implementation, not the older cron build plan.

Already shipped:

| Capability | Current anchor | Keep / reuse |
|---|---|---|
| Server-owned cron jobs | `sidecar/cron.js`, `sidecar/cron-store.js`, `sidecar/cron-driver.js` | Keep the scheduler, math, lock, retry, DST, and at-most-once behavior. |
| Routines CRUD and run-now | `sidecar/index.js` `/api/cron*`; `frontend/app/stationui.js` `buildRoutines` | Extend the data shape and UI; do not replace the panel. |
| Live cron events | `cron.fire`, `cron.result`, `cron.skipped`, `cron.tick` in `shared/events.js` | Reuse these as the live trigger. Avoid new event rungs unless the existing events cannot support the UX. |
| Floor visibility | `workitem.placed` from `placeWorkitem`; `frontend/app/world.js` listens to cron events | Keep this for "working now"; enrich with routine names/status from server state. |
| Persistent job outcome | `CronJob.lastRunAt`, `lastRunId`, `lastStatus`, `lastReason`, `lastError` | Keep as the compact row summary, but add a real activity/history layer. |
| Browser notifications | `StationUI.notify()` persisted in browser localStorage | Keep as the visual notification sink, but feed it from durable server receipts. |

The gap:

- A successful scheduled run may only be obvious if the user opens the Routines panel and notices `last ok`.
- `cron.result` is live-only; if the app was closed, there is no notification event to catch.
- The job record stores status, but not a user-readable result summary or bounded output preview.
- The Routines panel is a management surface, not an activity inbox.
- Manual run-now shows output inline, but unattended scheduled runs do not produce an equally discoverable receipt.

---

## 2. Product Contract

Build the feature around one concept: **Routine Activity**.

Every routine fire should create a durable receipt with:

- what was supposed to run
- when it was scheduled
- when it started
- when it finished
- whether it succeeded, failed, skipped, or reported silent
- a short result summary or output preview
- a link/join to the run, transcript, or artifact when available
- whether the user has already been notified about that receipt

User-facing rules:

1. **Schedule clarity:** every routine row must show enabled/paused, next run, agent, schedule, and last result.
2. **Working-now clarity:** a running routine must show as running in the row, in the activity timeline, and on the floor/HUD.
3. **After-the-fact clarity:** if the app was closed, the next app open must create unread notifications for unseen completed/failed/silent receipts.
4. **Result clarity:** a completion receipt must include enough text to answer "what happened?" without searching logs.
5. **Failure clarity:** failures are never silent. They show a notification, row error, and activity record.
6. **No duplicate notifications:** each receipt creates at most one browser notification.

---

## 3. Data Model

Add a server-owned activity store:

- File: `WORKSPACES/cron.activity.jsonl`
- Module: `sidecar/cron-activity.js`
- Discipline: pure reducer / injected clock where possible; ambient file I/O only from `sidecar/index.js`, following the existing durable write pattern.

Activity record shape:

```js
{
  id: "ca_<short-id>",
  ts: 1710000000000,
  type: "scheduled" | "started" | "completed" | "failed" | "silent" | "skipped" | "disabled" | "enabled",
  jobId: "job",
  runId: "run-or-null",
  agentId: "agent",
  jobName: "Morning brief",
  scheduleDisplay: "cron 0 9 * * *",
  scheduledFor: 1710000000000,
  startedAt: 1710000000100,
  finishedAt: 1710000015000,
  status: "running" | "ok" | "failed" | "silent" | "skipped",
  reason: "done",
  error: null,
  summary: "Found 3 notable AI policy updates.",
  outputPreview: "Short bounded assistant output preview...",
  outputChars: 1840,
  nextRunAt: "2026-07-01T09:00:00.000Z"
}
```

Retention:

- Keep the latest 500 records globally.
- Keep enough fields on each record that the UI can render without joining against old job definitions.
- Never store secrets; run all assistant-derived text through the existing redaction path before persisting.
- Bound `summary` to roughly 240 chars and `outputPreview` to roughly 1200 chars.

Cursor / notification dedupe:

- Add browser-local cursor: `StationUI` stores `lastCronActivityNotifiedId` or `lastCronActivityNotifiedTs`.
- The server remains source of truth for receipts; browser localStorage is only the notification cursor.
- On app open and Routines panel open, fetch unseen receipts and call `StationUI.notify()` once per receipt.
- If localStorage is reset, old receipts may show again; that is acceptable for v1. A server-side ack file can be a later hardening if needed.

---

## 4. API Changes

Extend existing endpoints rather than creating a second cron surface.

### `GET /api/cron`

Add computed fields to each job:

```js
{
  running: true,
  activeRunId: "run-id",
  lastActivityId: "ca_...",
  lastSummary: "...",
  lastOutputPreview: "...",
  lastFinishedAt: "2026-06-29T09:02:00.000Z"
}
```

The row still renders from the job list, but now it can show `running now` and a useful last result.

### `GET /api/cron/activity?limit=100&since=<id-or-ts>`

Return newest activity records, optionally filtered after the cursor:

```js
{
  ok: true,
  activity: [ ... ],
  newestId: "ca_..."
}
```

This endpoint powers the activity inbox, notification reconciliation, and live refresh after `cron.result`.

### `GET /api/cron/activity/:id`

Optional v2. Only add if the initial timeline needs expandable records without loading full previews in the list.

---

## 5. Backend Integration

Activity should be emitted at these points:

| Point | Existing code | Activity |
|---|---|---|
| Routine created | `handleCronCreate` | `scheduled` receipt with first `nextRunAt`. |
| Routine enabled/disabled | `handleCronArm`, `handleCronUpdate` | `enabled` / `disabled` receipt. |
| Scheduler fires | `cron-driver.fireJob` via injected deps | `started` receipt with `jobName`, `agentId`, `runId`, `scheduledFor`. |
| Scheduler skips | `cron.skipped` paths | `skipped` receipt with reason. |
| Scheduler finishes | `finishFire` | `completed`, `failed`, or `silent` receipt with summary/preview/error. |
| Manual run-now starts | `handleCronRun` | `started` receipt with `manual:true` if useful. |
| Manual run-now finishes | `handleCronRun` finally block | Same completed/failed/silent receipt path as scheduler. |

Recommended implementation shape:

- Add `recordCronActivity(record)` in `sidecar/index.js`.
- Inject `recordActivity` into `makeCronDriver`.
- Keep `sidecar/cron-driver.js` deterministic by treating activity as an injected side effect, just like `emit` and `placeWorkitem`.
- Avoid changing `shared/events.js` in the first slice. Use existing `cron.fire` / `cron.result` as live nudges, then fetch `/api/cron/activity` for rich data.

Summary extraction:

- For success: derive from assistant text with a simple deterministic `summarizePreview(text)` helper:
  - trim whitespace
  - first non-empty paragraph or first 240 chars
  - if output is empty: `"Completed with no text output."`
- For `[SILENT]`: summary should be `"Checked; nothing new to report."`
- For failure: summary should be the error/reason, never blank.

Run/transcript joins:

- If cron runs already record into `runStore`, include `runId`.
- If scheduled runs do not have a useful `streamId`, do not invent one in this slice. Add a follow-up decision for per-routine stream ownership.

---

## 6. Frontend Integration

### Routines Panel

Update `buildRoutines` so each row shows:

- status badge: `scheduled`, `running`, `paused`, `failed`, `completed`, `silent`
- next run: absolute local time plus relative time
- last run: status, relative time, and one-line summary
- active run: `running now` with agent name and started time
- actions: run now, pause/enable, delete, open activity

Keep the panel dense and operational. This is not a marketing page.

### Routine Activity Inbox

Add a sub-view inside the existing Routines panel rather than a separate top-level nav item:

- Tabs: `ROUTINES` and `ACTIVITY`
- `ACTIVITY` shows newest-first receipts:
  - started
  - completed
  - failed
  - silent
  - skipped
  - enabled/disabled
- Each receipt shows job name, agent, time, status, summary, and run id/artifact link when available.

### Notification Reconciliation

Add `StationUI.reconcileCronActivity()`:

1. Fetch `/api/cron/activity?since=<cursor>`.
2. Filter for user-notifiable records:
   - `completed`
   - `failed`
   - `silent`
   - `skipped` only for actionable reasons like `no-capability`, not normal `already-running` noise.
3. For each record, call `notify(text, cls)`.
4. Advance cursor only after notifications are stored.

Notification copy:

- Success: `Routine "Morning brief" completed - Found 3 updates.`
- Failure: `Routine "Morning brief" failed - no capability.`
- Silent: `Routine "Morning brief" checked - nothing new.`
- Skipped/actionable: `Routine "Morning brief" skipped - missing model/key.`

Trigger reconciliation from:

- app boot after `StationUI` starts
- opening the Routines panel
- receiving live `cron.result` over SSE
- receiving live `cron.skipped` over SSE for actionable skip reasons

### Live Status

Update `world.js` cron listeners:

- On `cron.fire`: fetch/merge job name and show `Routine "X" started`.
- On `cron.result`: fetch latest activity and notify with summary.
- Keep generic fallback copy if fetch fails.

---

## 7. Build Sequence

Each slice should be one small commit, tests first where possible.

### Slice 1: Activity Store

Goal: durable routine receipts exist, without UI changes.

Files:

- `sidecar/cron-activity.js`
- `sidecar/index.js`
- `test/cron-activity.test.js`

Tests:

- append and list records in newest-first order
- corrupt/missing store fails closed
- retention keeps latest 500
- summaries/previews are bounded and redacted

DoD:

- `npm run test:fast` passes
- no shared event changes
- no UI dependency

### Slice 2: Record Scheduler Activity

Goal: scheduled and manual runs create receipts for started/completed/failed/silent/skipped.

Files:

- `sidecar/cron-driver.js`
- `sidecar/index.js`
- `test/cron.tick.test.js`
- `test/cron.api.test.js` if needed

Tests:

- due job records `started` then `completed`
- throwing run records `failed`
- `[SILENT]` records `silent`
- no-capability skip records actionable `skipped`
- manual `/api/cron/run` records the same receipt types

DoD:

- existing cron behavior unchanged
- receipts are written after real state transitions only
- no phantom activity for idle ticks

### Slice 3: Activity API and Job Snapshot Enrichment

Goal: frontend can ask the server what happened.

Files:

- `sidecar/index.js`
- `test/cron.api.test.js`

Tests:

- `GET /api/cron/activity` returns bounded records
- `since` cursor filters correctly
- `GET /api/cron` includes `running`, `activeRunId`, `lastSummary`
- no secret-shaped data appears in activity snapshots

DoD:

- token-gated like other local data APIs
- cache-control no-store
- activity endpoint works after restart

### Slice 4: Notification Reconciliation

Goal: user gets notified about cron runs that finished while the app was open or closed.

Files:

- `frontend/app/stationui.js`
- `frontend/app/world.js`
- `test/autonomy-ui.test.js` or a new focused UI test if existing coverage fits

Tests:

- unseen completed receipt creates one notification
- repeated reconcile does not duplicate notification
- failed receipt creates warn notification
- silent receipt creates low-noise notification
- actionable skip creates warn notification

DoD:

- notifications survive through existing `store.notifs`
- cursor advances only after notify is stored
- app-open and live-SSE paths use the same reconciliation function

### Slice 5: Routines Panel Activity View

Goal: users can inspect schedule, current work, and results in one place.

Files:

- `frontend/app/stationui.js`
- `frontend/css/app.css` or existing relevant CSS file if needed
- UI test if available

Tests:

- row renders running status
- row renders last summary
- activity tab renders completed/failed/silent/skipped states
- empty activity state is honest

DoD:

- no nested cards
- no hidden server truth in localStorage
- usable on narrow viewport without overlapping text

### Slice 6: Result Links and Transcript Follow-Up

Goal: receipts can open the underlying run/transcript/artifact when that data exists.

Files:

- `sidecar/index.js`
- `frontend/app/stationui.js`
- `test/runstore.test.js` or cron API test

Tests:

- activity includes `runId`
- if a stream/transcript join exists, UI can open it
- if no join exists, UI shows summary/preview without a broken link

DoD:

- no fake transcript link
- no requirement to invent routine-owned streams in this slice

---

## 8. Acceptance Criteria

The feature is done when:

- A user can open Routines and see what is scheduled next.
- A user can see when a routine is currently running.
- A user gets an unread notification after a routine completes, fails, or reports silent, even if the app was closed during the run.
- A user can open Activity and read what happened for recent routine runs.
- Failures are visible in the row, notification list, and activity view.
- Successful runs have a bounded, readable summary or preview.
- Reconciliation does not duplicate notifications.
- `npm run test:fast` is green.

Live verification:

- Start the app.
- Create a one-shot routine scheduled in one minute.
- Close the Routines panel.
- Let it fire.
- Confirm HUD/notification appears.
- Restart app.
- Confirm the activity receipt still exists.
- Confirm no duplicate notification appears after repeated refresh.

---

## 9. Deferred Decisions

These are useful but should not block the first visibility pass:

- Server-side notification ack/cursor file instead of browser-local cursor.
- Per-routine durable transcript stream ownership.
- External delivery targets for cron results via Telegram/Discord/email.
- Native OS notifications.
- Rich model-generated summaries instead of deterministic previews.
- A new additive `cron.activity` event rung. Use only if fetch-on-`cron.result` proves too clunky; coordinate with the shared contract owner first.

