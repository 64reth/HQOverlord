---
fingerprint: b8594ab9
slug: room-fixture-grids-flood-edges-and-corners
title: Room fixture grids flood edges and corners
surface: world
severity: P2
status: fixed
found: 2026-09-06
lane: agent/room-lighting-strip
fix: 1525663d0
origin: owner
report: Owner visual comparison of telescope room and wood-floor mancave, 2026-09-05
affected: Source snapshot 07a643772; installed build unknown
family: room-lighting
installer: unverified
recovery: unconfirmed
---

# Room fixture grids flood edges and corners

## Symptom

The telescope room is broadly and evenly lit, including its sides and corners, instead of retaining the centered illumination of the wood-floor mancave reference.

## Repro

Run the seeded preview on port 9197. `dev/room-lighting-proof.mjs reference-scaled` checks seven sizes. `dev/room-lighting-reference-proof.mjs` compares the saved reference room with the original renderer using the approved ambient lift.

## Evidence

The owner's actual HAB-16 reference is 15x14 with a single column and two original top/bottom fixtures. The current renderer reproduces its original baked base and lightmap byte-for-byte after applying the same approved ambient adjustment (0.84 to 0.82). Glow was reduced separately from 0.07 to 0.06. Seven room sizes preserve two sources, darker sides and illuminated north walls. Reference parity, seeded screenshots and measurements are in `.worldshots/room-lighting/`; portable summary is `qa/digests/2026-09-06-room-lighting-strip.md`.

## Verdict

The owner accepted the local preview and requested final validation and integration. This supersedes the earlier centered-cell and continuous-strip experiments. Installed build remains unverified; acceptance of the source preview does not claim installer recovery.

Update, 2026-09-06: the owner retracted that acceptance after using the centered design and explicitly requested even coverage across each room. The active correction is tracked in `qa/bugs/741832d8-centered-room-lighting-leaves-sides-dark-and-cre.md`. Matching the old two-source reference is no longer the acceptance requirement; do not restore it as a regression fix.

## Regression

Source positions and radius scale from the approved reference room. Column count no longer grows with width. Original falloff, sheen and light temperature remain; the approved ambient/glow values and CRT lab Reset defaults agree. Focused station-bake coverage checks seven room sizes and chunk/monolithic parity.

## Sibling coverage

{"adapters":[{"target":"room material and prop emission","state":"blocked","reason":"Live telescope and plank-floor browser scenes checked; not a registered fast/http pixel test."}],"entrypoints":[{"target":"existing and resized rectangular rooms","state":"blocked","reason":"Six room sizes verified by dev/room-lighting-proof.mjs; irregular multi-rectangle rooms remain a coverage gap."}],"displays":[{"target":"world and build preview bake","state":"blocked","reason":"Shared StationBake renderer changed; live world verified, build preview and installed desktop not exercised."}],"lifecycle":[{"target":"reload/rebake","state":"blocked","reason":"Repeated browser loads and World.loadStation/rebake verified; installed restart not exercised."}]}
