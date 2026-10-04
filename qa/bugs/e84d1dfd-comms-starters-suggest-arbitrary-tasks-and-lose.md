---
fingerprint: e84d1dfd
slug: comms-starters-suggest-arbitrary-tasks-and-lose
title: COMMS starters suggest arbitrary tasks and lose session context
surface: sessions
severity: P2
status: fixed
found: 2026-09-06
lane: agent/useful-starters-0906
fix: 33d995fed
origin: owner
report: Owner screenshot and request, 2026-09-06
affected: Build unknown; source 94028fa48
family: session-starters
installer: unverified
recovery: unconfirmed
---

# COMMS starters suggest arbitrary tasks and lose session context

## Symptom

Empty COMMS repeatedly offers an arbitrary Morning Brief, a tour, and a vague intake question in centered wrapping buttons. Session follow-ups start a new prompt with only a title instead of opening the original context.

## Repro

1. Open an empty COMMS session on a fresh station: the first catalog recipe appears without user intent.
2. With an existing titled conversation, open a new session and choose its next-step suggestion: only the title is sent into the new conversation.

## Evidence

Owner screenshot 2026-09-06. Source baseline 94028fa48 in frontend/app/starters.js selected `recipes[0]` and synthesized a session follow-up from its title. Regression coverage: test/starters.test.js.

## Verdict

Source repaired in 33d995fed. Installed desktop and reporter recovery remain unverified.

## Regression
Baseline selected the first catalog recipe, offered morning recipes without prior use, and sent only a session title into a new conversation. test/starters.test.js now executes the selector and production DOM/click functions: 37 assertions pass for activity ordering, age filtering, archive/busy/shipped exclusion, actual session context, same-agent filtering, nonduplicated rendering and editable drafts. Live seeded app on port 9296 displayed stacked task templates, filled the composer without sending, and after restart opened the persisted "Prepare the launch checklist" conversation with its original user message. Browser warning/error log was empty. See docs/SESSION_STARTERS_2026-09-06.md.



## Sibling coverage
{"adapters":[{"target":"local recommendation selector","state":"covered","test":"test/starters.test.js","scenario":"recent sessions and recipe launches; malformed and missing evidence","gate":"fast"}],"entrypoints":[{"target":"fresh and returning COMMS","state":"covered","test":"test/starters.test.js","scenario":"same-agent signal adapter, actual session navigation, editable draft click","gate":"fast"}],"displays":[{"target":"browser and website source","state":"covered","test":"test/website-app-sync.test.js","scenario":"frontend and generated website mirror remain synchronized","gate":"fast"},{"target":"installed Windows/macOS","state":"blocked","reason":"This source repair has not been packaged or tested in an installed release."}],"lifecycle":[{"target":"launch memory reload","state":"covered","test":"test/starters.test.js","scenario":"saved recipe timestamps survive store reread; corrupt storage yields no evidence","gate":"fast"},{"target":"session archive after render","state":"covered","test":"test/starters.test.js","scenario":"stale shortcut revalidates its target before opening","gate":"fast"}]}
