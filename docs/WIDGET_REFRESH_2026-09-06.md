# Widget library refresh

## Usefulness revision — owner feedback

Done means the default picker shows attention, the upcoming routine, and agent feeds;
historical/diagnostic counters live in an explicit Stats category; existing pins remain
manageable. A pinned routine opens scheduling, and attention opens a current waiting
conversation without answering or approving it. The full fast gate must pass.

New stations pin NEEDS YOU instead of RUNS · 24H. Existing v1 layouts remain unchanged.
CREW, ACTIVE COMMS, QUEUE, ROUTINES count, RUNS · 24H, and TOKENS move to Stats.
NEEDS YOU covers both approval and answer prompts and reads `clear` when none are pending.
NEXT ROUTINE shows its stopped/empty state instead of an unexplained dash.
Both have explicit rail navigation buttons; the attention shortcut is disabled when no
current conversation can be opened. Agent feeds remain in the default picker with provenance.

Live proof at :9186: main picker contained only `approvals,next` at 340 x 164px;
Stats contained the six counters and searching tokens returned only TOKENS. Existing five
pins survived the code reload; removing the three preview counters left `approvals,next`
after another reload. The routine arrow opened AUTOMATION / ACTIVE ROUTINES with the
scheduler still off. The attention button was disabled while NEEDS YOU read `clear`.
A temporary production widget.set feed appeared in the main picker with NOVA attribution,
then was cleared; the final picker returned to two rows. Escape restored focus, the picker
fit a 600 x 500 viewport, and no native-white controls or browser warnings/errors were found.
Pending-conversation navigation and stale-target rejection passed the 73-assertion widget
test; no live approval was issued for this visual/catalog revision.
Full gate: `npm run test:fast` passed all 725 steps (exit 0) at candidate
`382a66e28ee4909bf443ba2686a6e5e21aa11d21`. Source syntax, generated website mirrors,
and diff whitespace checks passed. This remains source-verified in the isolated branch,
not merged or installed.

## Compact picker revision — owner visual feedback

The owner rejected the oversized card layout. The library now uses flat 29px instrument
rows, one label per widget, inline TOP / BTM / remove controls, and hover help. The intro,
descriptive paragraphs, nested preview panels, reorder button rows, and footer are removed.
Search, filters, live values, feed attribution, rail dragging, and keyboard arrangement remain.
An opaque theme background and compact search field replace the large translucent panel.

Live measurements: 340 x 338px for all eight built-ins, with no scrolling (previously
540 x 845px on the same preview). The popup is capped at 360px high for longer feed lists.
Search -> Top -> Bottom -> remove and Escape passed in the running app, with zero white
controls. This revision supersedes the original card-layout measurements below.

Compact revision verification: `npm run test:fast` passed all 725 steps at candidate
`91bf8eba5`. The picker stayed within the 600 x 500 viewport; a temporary production-path
feed retained NOVA attribution, and nine rows scrolled within the 360px height cap.
The fixture was removed, all eight built-ins restored, and the browser reported no warnings
or errors. Syntax, mirror generation, and diff whitespace checks also passed.

Owner request: update the outdated widget system.

Done means opening the live widget library, finding and pinning an instrument, moving and
reordering it, and recovering the same layout after reload and sidecar restart. Feed readings
must preserve attribution, report outages, and show no signal when their source is removed.
The full fast gate must pass.

## Changes

- Searchable library with All, Station, Agent feeds, and Pinned filters, live previews,
  source descriptions, and explicit Top / Bottom / Hide controls.
- Eight built-in instruments: existing runs, queue, routines, and tokens plus crew count,
  confirmed active COMMS conversations, COMMS approval requests, and next scheduled routine.
- Reorder buttons, Alt + arrow movement, Enter to manage, focus restoration, Escape,
  keyboard focus containment, responsive scrolling, and themed controls.
- Existing v1 layout storage and feed pins retained. Missing feed pins stay manageable.
- Current roster name resolution, absent-progress handling, feed offline state, bounded and
  deduplicated HTTP polling, and drag cancellation / UI zoom handling.
- Routine edits refresh the shared scheduler query, updating widgets immediately after
  creating, arming, disabling, or removing a routine rather than waiting for the next poll.
- Generated website app mirror synchronized. No backend or shared-contract changes.

## Live evidence

Isolated seeded application at `http://127.0.0.1:9186`, launched with `node dev/seed.js --keep`.

- Added CREW to top, moved it to bottom beside ACTIVE COMMS, and moved it earlier.
  Reload restored bottom order `crew, active`. Alt + ArrowUp then moved CREW to top.
- Search returned the matching instrument; a nonexistent search returned an explicit
  empty result. Clearing the search restored the catalog. Agent feeds had a useful empty state.
- Escape closed the library and restored focus to its entry button. Enter on APPROVALS
  reopened it. Placement controls remained in the library after each edit.
- At 1280 x 720 the library bounds were x=255.4, y=59, w=540, h=653, with internal scrolling.
  At 600 x 700 the bottom-rail library stayed within x=52..592 and y=8..658.75.
  The library's controls had zero white/native background matches. No browser warnings or
  errors were recorded during normal interaction before intentional outage testing.
- A disposable feed was published through the production `widget.set` tool and durable
  store in this worktree's scratch station, then loaded after restart. The live rail read
  `RESEARCH DIGEST / NOVA / 12 sources`; its real four-point spark rendered, with no false
  zero-progress bar. This was a labelled verification fixture, not a real research result.
- Stopping only this worktree's sidecar retained `12 sources`, added `offline` beside NOVA's
  age stamp, and set `data-stale=1`. The tool then cleared the test record while stopped.
  Restart retained the layout and showed the absent feed as `no signal`. Pinned filtering
  still exposed its Hide control. The temporary feed and pin were removed.
- The next routine preview showed `disarmed` for the real disabled scheduler.
- A disposable future routine was created through Automation. Enabling scheduling immediately
  changed NEXT ROUTINE to its countdown; disabling scheduling immediately restored the empty
  reading. The fixture was deleted through the two-step UI and scheduling was left off.
- A second disposable feed appeared in the already-open library on the next poll. Changing
  its label and value updated both the card heading and preview without reopening. It was removed.

## Validation

- JS syntax checks and `git diff --check` passed.
- Widget folds: 66 assertions; widget feed tool: 43 assertions; shared query wiring: 16 assertions.
- Final committed code candidate `9883624df`: `npm run test:fast` passed 725/725 steps,
  exit 0 (`dev/widget-fast-verified.log`). Earlier full development passes also completed 725/725.
- The first committed synchronized candidate stopped at the source-fingerprint check. The
  normal re-lock utility refreshed only changed frontend hashes and the source SHA, preserving
  all 37 claims and verdicts. The committed claims-authority regression passed 64 assertions.
- No installed-desktop build or real-provider run was performed. HTTP gate is not required
  for this frontend-only change. No public deployment or release was performed.

The implementation is committed on `agent/widget-refresh-0906` in its isolated worktree;
it has not been merged to the integration branch or installed. The branch includes catalog
changes through `c3aad9ecd`. The later voice lane on trunk is not part of this preview;
integration must synchronize with current trunk and refresh combined source fingerprints.
