---
fingerprint: 52397fc0
slug: raised-room-corners-excluded-from-interior-light
title: Raised room corners excluded from interior lighting
surface: world
severity: P2
status: fixed
found: 2026-09-06
lane: agent/room-lighting-strip
fix: 624e58ede
origin: owner
report: Owner screenshot of dark broken-looking upper-left room corner, 2026-09-06
affected: Source c0ca851e2; installed build unknown
family: room-lighting
installer: unverified
recovery: unconfirmed
---

# Raised room corners excluded from interior lighting

## Symptom

The raised upper corner looks like a dark notch or broken wall panel beside the lit straight wall. The screenshot circles the left chamfer and its vertical continuation.

## Repro

Open the seeded :9197 preview on source c0ca851e2. Inspect either top corner of a ribbed wall with 30px height. Run `node dev/room-corner-light-proof.mjs` to compare the old source against the candidate on real browser canvases.

## Evidence

`.worldshots/corner-light/results.json` covers three wall materials, four heights and two corner shapes (24 cases). On the 30px chamfer, 694 painted face pixels were missing from the old receiver; none are missing after the correction. Every case has zero missing face coverage, zero unrelated receiver changes and zero base-art changes. Before/after PNGs and the live capture are in the same directory. `test/stationbake.chunk.test.js` includes raised-face coverage and sky exclusion at both top corners plus chunk/full-lightmap parity.

## Verdict

The interior receiver was assembled from the floor outline and straight north-wall rectangles. It omitted the raised corner-face pixels drawn outside those rectangles, so the final lightmap treated those pixels as exterior hull. Source 624e58ede records actual clipped corner-face spans in the painter and includes them in the receiver before excluding the crown. This follows both corner shapes and nearer-wall clipping automatically. Source/live validation is in qa/digests/2026-09-06-corner-lighting.md. Installer and owner recovery remain unverified.

## Regression

Registered fast test/stationbake.chunk.test.js checks both top corners at heights 14/30/50 for chamfers and round corners, sky exclusion, and full/chunk parity. The real-canvas driver also covers flat walls and wall materials; the original reproduction fails on the old receiver. Lighting controls, material colours and wall artwork are unchanged.

## Sibling coverage

{"adapters":[{"target":"wall materials and shapes","state":"blocked","reason":"Real browser proof covers ribbed, plating and viewport materials at four heights and two shapes; this native canvas driver is outside the fast suite."}],"entrypoints":[{"target":"top-left and top-right raised corners","state":"covered","test":"test/stationbake.chunk.test.js","scenario":"Both top faces receive light at three heights and two shapes while sky stays excluded","gate":"fast"}],"displays":[{"target":"full and chunked lightmap","state":"covered","test":"test/stationbake.chunk.test.js","scenario":"Corner lighting has identical composed light pixels in full and chunked bakes","gate":"fast"}],"lifecycle":[{"target":"wall height and corner shape rebake","state":"covered","test":"test/stationbake.chunk.test.js","scenario":"Repeated bakes change wall height and shape without stale corner coverage","gate":"fast"}]}
