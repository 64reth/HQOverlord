# Connected-app widgets

Owner direction: choose a connected app, define what to track, and display actual readings
with refresh, source and error states. The previous counter-first candidate is superseded.
Keep a few useful presets: Revenue snapshot, Tasks due, Daily brief.

Done means creating a widget through the live Connected apps picker, observing a connector
read publish its value, changing and refreshing it, retaining the previous reading during
an outage, and recovering after a sidecar restart. Deleting a widget must also remove its
linked schedule. Required syntax, fast and HTTP gates must pass before integration.

## Implementation

- Your widgets / Connected apps / Pinned picker; no default station counters. Old pins remain
  manageable. Three editable presets plus custom Number, List, Trend and Progress displays.
- Sources are the current MCP manager and configured service-key inventory, plus information
  StarNet manages. API keys are labelled configured rather than independently verified. The
  inventory exposes no credentials, token values, connection headers or process arguments.
- Saved source identity, request and display type live beside the reading in the durable widget
  store. A definition alone has no reading or update timestamp. Editing clears the old reading
  and advances a version; stale publications and stale editors cannot overwrite it. Deletion
  leaves a bounded tombstone, and versioned publications cannot recreate missing definitions.
- Create & fetch / Refresh now opens a dedicated widget conversation through existing
  Workstreams, Chat, run-loop and connector permission boundaries. No raw connector-call bypass,
  autonomous grant, connector installation, or credential change is introduced.
- widget.set validates the requested display shape. Failure retains the previous value and
  timestamp. Details show the source app, reporting agent, time, source link and error; an
  unavailable source is explicit. An agent report is not described as an independently
  verified app fact. No personal source data was used during verification.
- Schedule updates pre-fills the existing Automation editor. Nothing runs automatically until
  the user saves a schedule and arms scheduling with the needed access. widget.get reads the
  current definition each scheduled run. Linked schedule status is displayed from the real cron
  snapshot. Deletion aborts linked scheduled runs and removes their jobs before removing the
  widget; unrelated routines are preserved. Concurrent schedule creation is fenced during deletion.
- Native theme controls, bounded popup, keyboard focus containment, source-safe links, and
  text-only rendering of app/agent strings. Unused legacy insights counters no longer poll.

## Live evidence

`dev/widget-studio-replay.mjs` runs a labelled local MCP server and deterministic provider.
It exercises the actual HTTP connector, run loop, capability/consent machinery, widget tool,
durable store, UI and Automation. These are synthetic fixtures, not production account readings
or a model-quality evaluation. The normal preview is :9186; the disposable proof station is :9190.

- Created Revenue snapshot by selecting the connected Demo Revenue fixture in the browser.
  Provider trace: brief_proceed -> mcp__widget_demo__revenue_snapshot -> widget_set. UI showed
  $1240, then $1520 after a changed source response and Refresh now. Actual agent/run/time and
  source URL were persisted. No direct store injection produced the readings.
- Source failure recorded an error while retaining $1520 and its original timestamp. That
  state and its pinned layout survived a sidecar restart. Restored controls opened the detail;
  recovery fetched $1680 and cleared the error.
- The schedule editor received the saved widget id and a prompt to call widget.get first.
  Saved a linked job with the explicit connectors grant. Run Now exercised the scheduler's
  real unattended posture: widget_get -> connector read -> widget_set, publishing $1790.
  Global scheduling remained off and the widget correctly said scheduled updates paused.
- Edited the saved widget to Trend. Its version advanced to 2; $1790 and the actual three-point
  series [1590,1690,1790] appeared, with a visible 48px chart in details.
- Disabled the fixture connector. Its old reading remained visible with app disabled; refreshing
  returned an actionable reconnect error and performed no source read. An unknown source was
  rejected with 400; a token-less sources request was rejected with 403.
- Deleted the widget through its UI. Both widget inventory and its linked cron-job count became
  zero. Source-data configuration and other app data were not modified.

Focused checks: widgets 78, widgetfeed 70, capgate 54, harness integration 182, toolprops 145,
query-spine wiring 16, and fail-open ratchet 156 assertions passed. Malformed optional source
links are omitted without discarding a valid reading.

## Final visual receipt

- Created the Tasks due list preset through the UI and observed both source-returned items in
  details. The pinned list ticker remained visible at the 1049px viewport (14.625px height).
- At 600x500, widget details measured 340px wide, stayed within the viewport horizontally,
  and scrolled internally. The empty library measured 340x255.625 with only three presets.
- The Name, What should it show?, and Display fields have working accessible labels. Selecting
  a display and pressing Escape returned focus to Add widget. No white native controls or
  browser warnings/errors were observed.
- Deleted the disposable fixture widgets and their linked schedule, then stopped the proof
  services on ports 9190/9191. The normal seeded preview remains available on port 9186 with
  Your widgets open. The fixture supplied no production-account data.

## Gate receipt

Code candidate: `4d7b346a2ff88465a162aa69140adfc0f1ecf2f9`.
`npm run test:fast` passed all 725 steps and `npm run test:http` passed all 101 steps
on 2026-09-06. Both completed with exit code 0. Syntax checks on changed JavaScript and
`git diff --check` passed; the website mirrors match the frontend sources. The final
source-link parser fix also passed widgetfeed (70) and fail-open ratchet (156) assertions.

Local logs: `dev/widget-studio-fast.log` and `dev/widget-studio-http.log` (ignored).
The subsequent commit only records this verification receipt.

No merge, install, or release is claimed by this source receipt.

## Button polish follow-up

At the owner's request, `0dd85745068e6776fcbc942dcc30c4e5555aaa8c` gives only the empty-rail
Pin a widget button a quiet inset finish and tighter lettering through the shared action-surface
tokens. Live computed styles on both rails confirmed 22px height, solid border, 4% phosphor
fill, and a single inset hairline. Clicking opened the library; Escape closed it and restored
button focus. Website mirror synced. Widgets passed 78 assertions and the full fast gate
passed all 725 steps on `3f9b8894c` (source fingerprint follow-up). No backend code changed.
