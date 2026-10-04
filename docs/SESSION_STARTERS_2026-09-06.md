# Session starter repair — 2026-09-06

Owner report: irrelevant repeated starters and centered wrapping buttons in empty COMMS.

Selection now prioritizes recent same-agent conversations with real user history (up to two)
and a recently used recipe. Evidence expires after 30 days; archived, running and shipped
sessions are excluded. Session actions reopen by id with original history rather than
sending a title-only prompt to a new conversation. Missing evidence yields three explicit
editable tasks: Plan a task, Compare options, Improve a draft. No catalog-order, time-of-day
or intake-question filler. Recipes keep existing editable launch behavior.

Presentation is a left-aligned single-column stack with full titles, explanatory subtitles,
keyboard focus and trailing chevrons. Connection authority preserves the new heading after
the bridge is proven; connecting/unavailable states retain their existing behavior.

Live proof: isolated `node dev/seed.js --keep`, port 9296. Fresh state showed the three task
templates. Selecting Plan a task filled and focused the composer without a send or run.
Computed button bounds were x=757, width=262, with sequential y positions 293.95, 378.73,
463.52; all text aligned left and no controls used white native backgrounds. Full browser
visual inspection confirmed no overlap or clipping in the narrow COMMS panel. After a
seeded conversation was persisted and the sidecar restarted, the empty session showed one
useful shortcut. Clicking Prepare the launch checklist selected the original session and
rendered its existing message about landing page, signup and announcement work. Browser
warning/error log: empty. Fixtures were local QA data, not real model output.

Focused regression: `node test/starters.test.js` — 37 assertions green, including production
signal gathering and click handlers against the real Workstreams store. Full fast gate:
725/725 before integration at fa05bcc1d, and 725/725 after integration (exit 0). During the
post-merge gate, 9fb380c28 added only the separate voice lane's documentation; the application
source stayed identical. Website mirror check: 8 assertions green. No sidecar route or
provider changes. Integration preserved the existing QA status edits and Rooms handoff.

Installed release behavior and owner recovery have not been verified. Recommendations are
deterministic evidence-based shortcuts; no claim of universally useful model advice.
