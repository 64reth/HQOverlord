# Session 6 - Builder Bake Status

Updated: 2026-06-26T18:04:40-04:00

## Current Slice

Monolithic parity checkpoint:
- Added a `StationBake.missingVisibleChunks()` query so callers can detect when a camera pan exposes chunks that were not retained.
- Added `onlyMissingVisible` incremental bake mode so pan-driven fills bake only newly exposed visible chunks instead of treating a missing dirty rect list as a full-station dirty set.
- Wired `frontend/app/build.js` to pass the current bake-local camera viewport into `StationBake.bakeIncremental()` and `StationBake.drawBase/drawLight()`.
- Bounded REFIT chunk retention with a small visible/dirty chunk cache cap while preserving dirty and visible chunks.
- Documented the live REFIT viewport/culling behavior in `frontend/app/BUILDER.md`.
- Added seam/bounds release evidence for full chunk composites and origin-reset rebuilds.
- Deduplicated chunked flicker anchors so a multi-chunk cache emits the same glow anchor count as the monolithic bake.
- Upgraded the headless chunk test harness with a clipped pixel buffer for deterministic rectangle/blit operations.
- Added chunk-vs-monolithic baseline assertions for full base and light composites.

## Changed Files

- `frontend/app/stationbake.js`
- `frontend/app/build.js`
- `frontend/app/BUILDER.md`
- `test/stationbake.chunk.test.js`
- `docs/session-status/session-6-builder-bake.md`

## Evidence

- 2026-06-26 15:01 ET verification loop found no new Session 6 code changes needed. The branch already contains the chunked bake/cache checkpoint commits and the worktree was clean before gate reruns.
- 2026-06-26 16:00 ET verification loop found no new Session 6 code changes needed. The worktree remained clean before gate reruns, no active collision was reported for this ledger by `node scripts/board.mjs --files docs/session-status/session-6-builder-bake.md`, and the branch remains at the safe chunked bake checkpoint.
- 2026-06-26 17:01 ET verification loop found no new Session 6 code changes needed. `git worktree list`, `git status --short --branch`, and `node scripts/board.mjs --files ...` confirmed this worktree is clean, on `agent/gap6-builder-bake`, and has no active uncommitted collision on Session 6 owned bake files.
- 2026-06-26 18:04 ET verification loop found no new Session 6 code changes needed. `git worktree list`, `git status --short --branch`, and `node scripts/board.mjs --files ...` confirmed this worktree is clean, on `agent/gap6-builder-bake`, and has no active uncommitted collision on Session 6 owned bake files.
- `test/stationbake.chunk.test.js` now proves:
  - a 900x650 synthetic station uses a 3x2 chunk grid with no canvas larger than 384x384;
  - a single tile dirty rect maps to chunk `0,0`, rebakes one chunk, and reuses five untouched chunks;
  - visible viewport selection returns only intersecting chunks;
  - `drawBase(..., visibleRect)` draws only the visible chunk while preserving its world offset;
  - cold visible-only bake renders only requested chunks;
  - retained caches keep dirty and visible chunks while evicting older non-required chunks;
  - complete visible caches report no missing visible chunks;
  - panning a visible-only cache reports the newly exposed chunk;
  - `onlyMissingVisible` fills that newly exposed chunk without dirtying or rebaking the whole station.
  - full-station chunk draw coordinates cover the exact 900x650 bake area with no gaps, overlaps, or seam offsets;
  - origin changes reset stale chunk metadata while still rebuilding only visible chunks and never allocating full-world base/light canvases.
  - chunked flicker anchors match the monolithic bake count instead of duplicating once per retained chunk;
  - full chunk base and light composites match the monolithic bake baseline in the deterministic headless pixel harness.
- REFIT caller now computes the current camera viewport in bake-local pixels and uses it for bake, draw culling, and pan-triggered missing chunk fills.
- `npm.cmd run shoot` passed and captured all visual states on 2026-06-26 18:02 ET.
- `npm.cmd run golden` kept Session 6 builder bake frames stable on the fresh run: `build-station diff=0.09`, `build-manual diff=0.05`, `build-connectors diff=0.81`; the remaining changed frames are non-bake screens already tracked as blockers.
- `npm.cmd run audit` passed all builder/moat checks: `moat/build-mode`, `moat/place-prop`, `moat/capability-online`, and `moat/caps-well-formed`.

## Tests Run

- `node test/stationbake.chunk.test.js` - PASS, 32 assertions.
- `npm.cmd run test:fast` - PASS on 2026-06-26 18:01 ET, includes `stationbake.chunk`.
- `npm.cmd run shoot` - PASS on 2026-06-26 18:02 ET, all states captured.
- `npm.cmd run golden` - FAIL outside builder target on 2026-06-26 18:03 ET: `crew-roster diff=14.11`, `crew-summon diff=14.46`, `work-recipes diff=14.39`, `build-skills diff=2.41`; `build-station`, `build-manual`, and `build-connectors` passed.
- `npm.cmd run audit` - FAIL outside builder bake slice on 2026-06-26 18:04 ET: `summon/bay-open` never saw `.mkt-primary`; builder/moat checks passed and placeholder task lifecycle passed.

## Blockers / Holds

- `GOLDEN-UNRELATED-SCREENS`: golden remains blocked by non-builder frames. I did not bless unrelated baselines from this Session 6 worktree.
- `AUDIT-SUMMON-UNRELATED`: audit summon marketplace behavior is failing outside owned Session 6 files.

## Readiness Claim

Safe checkpoint remains ready for review, but Session 6 is not DONE. Chunked REFIT bake now has exact dirty chunk mapping, bounded chunk canvases, visible viewport culling, bounded retention, caller-side pan fills that do not rebake the whole station, deduplicated glow anchors, and monolithic-vs-chunk base/light parity evidence. `test:fast` is green on the latest run. Full ready remains blocked by unrelated golden/audit failures outside the Session 6 ownership boundary.

## Next Loop Condition

After unrelated visual/audit blockers are resolved or accepted, rerun `npm.cmd run golden` and `npm.cmd run audit`, then select the next scale slice: live-world chunk cache integration or additional browser-level large-station performance capture.
