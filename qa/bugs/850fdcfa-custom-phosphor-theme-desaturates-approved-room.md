---
fingerprint: 850fdcfa
slug: custom-phosphor-theme-desaturates-approved-room
title: Custom phosphor theme desaturates approved room lighting
surface: world
severity: P2
status: fixed
found: 2026-09-06
lane: agent/room-lighting-strip
fix: ba3e66447
origin: owner
report: Owner 0.11.0 comparison against approved 9197 preview, 2026-09-06
affected: Windows 0.11.0 owner test candidate
family: room-lighting
installer: unverified
recovery: unconfirmed
---

# Custom phosphor theme desaturates approved room lighting

## Symptom

The owner sees duller room colours in the 0.11.0 installed app than in the approved :9197 preview despite the warm lighting merge being included.

## Repro

Open Settings > Appearance at :9197. Keep room lighting LOW. Select AMBER, then CUSTOM. Before the fix, computed #stage.filter changes from saturate(1.06) contrast(1.1) brightness(0.94) to saturate(0.72) contrast(1.08) brightness(0.88), even with custom saturation at 100%.

## Evidence

Live in-app browser reproduction on 2026-09-06 returned theme-amber with filter saturate(1.06) contrast(1.1) brightness(0.94), then theme-custom with saturate(0.72) contrast(1.08) brightness(0.88), keeping LOW selected. The installed profile contained theme custom, hue 92, roomLighting medium. frontend/css/app.css applies the themed --cam-grade to #stage. test/simulation-lighting.test.js covers the station-grade contract and website parity.

## Verdict

The original lighting code is present in the release. The UI theme modifies the final station colour grade after the room is lit; the fix keeps the approved grade on the station independently of the panel theme. LOW/MEDIUM/HIGH still control room exposure.

## Regression

Before: AMBER to CUSTOM reduces feed saturation from 1.06 to 0.72. After: the live station retains the approved filter when changing themes, including a saved custom theme. Exact live and gate results are recorded in the companion digest.

## Sibling coverage

{"adapters":[{"target":"theme-independent station colour grade and website parity","state":"covered","test":"test/simulation-lighting.test.js","scenario":"approved station filter and identical website CSS","gate":"fast"}],"entrypoints":[{"target":"preset theme selection and saved custom theme","state":"blocked","reason":"Live browser round-trip exercised; no registered automated browser theme-transition scenario."}],"displays":[{"target":"installed Windows and macOS WebViews","state":"blocked","reason":"Release task must rebuild and verify the exact installer; source and browser proof alone do not establish installed recovery."},{"target":"Build renderer","state":"blocked","reason":"Build lighting renderer is unchanged; source lighting regression covers its steady glow, but new installed visual proof is pending."}],"lifecycle":[{"target":"lighting exposure preset persistence","state":"covered","test":"test/room-lighting-settings.test.js","scenario":"three preset mappings, fallback and persisted UI wiring","gate":"fast"},{"target":"saved custom theme reload","state":"blocked","reason":"Live reload is verified in the running preview; not a registered fast/http browser scenario."}]}
