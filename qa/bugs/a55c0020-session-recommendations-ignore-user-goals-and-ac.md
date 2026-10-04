---
fingerprint: a55c0020
slug: session-recommendations-ignore-user-goals-and-ac
title: Session recommendations ignore user goals and actual work
surface: sessions
severity: P2
status: fixed
found: 2026-09-06
lane: agent/useful-starters-0906
fix: 51768e661
origin: owner
report: Owner follow-up in session, 2026-09-06
affected: Source 33d995fed; installed build unspecified
family: session-starters
installer: unverified
recovery: unconfirmed
---

# Session recommendations ignore user goals and actual work

## Symptom

The empty session offers basic planning/comparison/drafting presets or recency shortcuts instead of consequential work informed by the user's goals and requests.

## Repro

1. Complete or discuss a specific project with NOVA, then open a new session.
2. The old selector chooses by activity timestamps or falls back to the same three basic templates; the substance of the conversation never influences the suggestion.

## Evidence

Owner correction on 2026-09-06. Baseline frontend/app/starters.js exports `pick` using recent timestamps and generic defaults. Regression anchors: test/starters.test.js and test/starterstore.test.js. Current source, live checks and limits: docs/PERSONALIZED_SESSIONS_2026-09-06.md.

## Verdict

Source repaired and owner-approved for merge. Full fast (726 steps) and HTTP (101 steps) gates passed after syncing with trunk. No installed recovery claim.

## Regression

The old selector used recency shortcuts and basic presets without reading the substance of user requests or goals. The new context engine cites actual work and goals, rejects unsupported or stale continuations, and retains three substantial general defaults. The seeded live UI changed from a dashboard suggestion to a cookbook suggestion when the stated priority changed; selection restored the exact source session and evidence, and dismissal survived reload. Tests cover these boundaries, provider failure, feedback hydration, and exact draft/run attribution. Live generation used a deterministic local provider; real-model quality remains unverified. See docs/PERSONALIZED_SESSIONS_2026-09-06.md.

## Sibling coverage

{"adapters":[{"target":"evidence and model-output validation","state":"covered","test":"test/starters.test.js","scenario":"goals, requests, source citations, capability bounds, stale and completed sessions","gate":"fast"},{"target":"real model recommendation quality","state":"blocked","reason":"Live verification used a deterministic local provider; real-provider quality was not evaluated."}],"entrypoints":[{"target":"general and personalized session selection","state":"covered","test":"test/starters.test.js","scenario":"production launch handler preserves history and drafts and prepares the correct session","gate":"fast"}],"displays":[{"target":"browser and shipped website mirror","state":"covered","test":"test/website-app-sync.test.js","scenario":"canonical frontend and website source remain synchronized","gate":"fast"},{"target":"installed desktop","state":"blocked","reason":"No installer was built or exercised for this source repair."}],"lifecycle":[{"target":"cache, feedback and attribution","state":"covered","test":"test/starterstore.test.js","scenario":"reload, dismissal, pause, forget, failed provider, hydrated feedback, exact run and rating attribution","gate":"fast"},{"target":"internal reasoning excluded from user work","state":"covered","test":"test/returns.test.js","scenario":"internal model runs do not create unattended-work rating prompts","gate":"fast"},{"target":"internal reasoning excluded from recommendation evidence","state":"covered","test":"test/contextpack.test.js","scenario":"internal run records do not become evidence about user activity","gate":"fast"}]}
