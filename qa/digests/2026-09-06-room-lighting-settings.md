# Three room lighting levels

Settings > Appearance > Room Lighting offers LOW, MEDIUM and HIGH. LOW preserves the approved room lighting exactly. MEDIUM and HIGH reduce ambient darkness from .82 to .72 and .62 respectively; fixture positions, radius, falloff, warmth and the .06 animated glow remain unchanged. Selection applies immediately, persists in the existing browser settings store and is included in station backup settings. Old or invalid values resolve to LOW.

Source commit `3da7b2d11`, fingerprints refreshed at `68997fdd5`. The full `npm run test:fast` gate passed all 723 steps, exit 0. Evidence: `.worldshots/room-lighting-settings/test-fast.log`.

Live seeded preview at http://127.0.0.1:9197/: all three controls changed the actual lightmap, with mean transmission .519 / .574 / .631 on the user's preview station. Lamp positions and radius were identical between levels, and glow stayed .06. Selection and aria-pressed state survived reload for every level; native Enter activated the focused button. Controls used station theme colors. HIGH also survived a graceful browser close and a sidecar restart, then the test profile was restored to LOW. The first restart probe force-killed Chrome before its disk flush; rerunning with graceful browser shutdown verified durable persistence.

Reproducible UI proof: `node dev/room-lighting-settings-proof.mjs`. Additional restart receipt and Low/Medium/High room screenshots are under `.worldshots/room-lighting-settings/`. The local preview is retained.

Merged `agent/room-lighting-strip` into `feat/harness-backend` at `9fa38c05bf9bebc2dbb4bb272cb50e0d6bc5401a`, from snapshot `91560ff9bdf5b80ff3e41ae23f5a48689ac7609e`. The post-merge `npm run test:fast` passed all 723 steps, exit 0 (`test-fast-trunk.log`). The merged source tree matches the preview, and the live three-level, reload and keyboard proof passed again after merging (`live-after-merge.log`). Existing dirty QA notes and the Rooms handoff were preserved. No installer was rebuilt or published.
