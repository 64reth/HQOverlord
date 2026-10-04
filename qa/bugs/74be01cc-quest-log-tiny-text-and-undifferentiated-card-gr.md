---
fingerprint: 74be01cc
slug: quest-log-tiny-text-and-undifferentiated-card-gr
title: Quest log tiny text and undifferentiated card grid
surface: world
severity: P2
status: fixed
found: 2026-09-06
lane: agent/quest-journal-revamp
fix: 55a30d5d7
origin: owner
report: Owner screenshot and redesign request, 2026-09-06
affected: Installed version unknown; current source 9fa38c05b reproduces 11px descriptions and 12.5px titles
family: quest-journal
installer: unverified
recovery: unconfirmed
---

# Quest log tiny text and undifferentiated card grid

## Symptom

Owner reports tiny, hard-to-read text and a quest log that feels like a dense grid rather than a game journal.

## Repro

Open WORK → QUESTS on a seeded station. At the default window size, compare the open quest descriptions, titles, objectives and reward hierarchy.

## Evidence

Owner screenshot supplied 2026-09-06. Source baseline 9fa38c05b uses 11px descriptions and 12.5px titles in frontend/css/motion.css. The regression anchor is test/quest-log-window.test.js.

## Verdict

Source redesigned and live-verified; integration blocked by full-gate timing failures. Installer and owner recovery remain unverified.

## Regression

The baseline shows all open quests as small equal-weight cards. The replacement shows a category-filtered mission index and one large briefing with distinct objective, reward and action. Production-renderer tests cover selection, escaping, filter empty states, data-poke retention, completion fallback, Commander level and draft guards (74 assertions). Live at :8916: 30px briefing titles, 18px descriptions, category and keyboard selection, empty category, real recruitment/dossier destinations, and 600px viewport reflow without horizontal overflow. Two disposable ledger quests proved evidence draft isolation, hidden-draft close warning, successful report-to-completion and clean close afterward; both were dismissed after verification.

## Sibling coverage

{"adapters":[{"target":"quest sources joined by QuestStore","state":"covered","test":"test/queststore.test.js","scenario":"source projection","gate":"fast"}],"entrypoints":[{"target":"Work dock and Commander header","state":"blocked","reason":"Work dock verified live; Commander header did not open in the first click attempt and needs separate investigation"}],"displays":[{"target":"desktop and website mirror","state":"covered","test":"test/website-app-sync.test.js","scenario":"frontend mirror parity","gate":"fast"},{"target":"installed desktop","state":"blocked","reason":"No installer rebuilt for this UI lane"}],"lifecycle":[{"target":"filter, selection, background poke, completion and draft guards","state":"covered","test":"test/quest-log-window.test.js","scenario":"production journal renderer transitions","gate":"fast"},{"target":"narrow window and themes","state":"blocked","reason":"600px viewport verified live without overflow; exhaustive theme matrix was not run"}]}
