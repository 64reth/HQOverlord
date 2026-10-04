# Steady, richer room lighting

The owner reported that the even-coverage preview had lost colour and its light moved too much. Source `970df704b` keeps the distributed fixture grid and diffuse room fill. It separates the 0.55 material colour/reflection gain from the 0.22 illumination-cut gain, restoring warmth and floor sheen without making basic room visibility depend on central pools. Ceiling halos hold at the previous mean intensity instead of the 83/210ms flicker. Their gradients are weakly cached and replaced on rebake. Build now uses the same room temperature and default glow intensity as the world. Screen, pulse and fire spill have slower, smaller modulation; activity gating and reduced-motion behavior remain intact.

This is an improvement to the existing Canvas lighting, not hardware ray tracing. Existing material albedo, contact shadows and warm/cool room temperatures remain in use. No new per-frame passes, pixel readbacks, blur filters or lights were added. The fixture pass no longer allocates a gradient per light per frame. Frame rate on installed hardware has not been benchmarked.

## Evidence

- `test/simulation-lighting.test.js`: 77 assertions; actual world/Build drawing functions hold stable at six timestamps, reuse gradients, replace them on rebake and restore canvas state. Four prop emission modes retain activity gating and reduced motion. Website mirrors match.
- `test/stationbake.chunk.test.js`: 64 assertions; chunk/full bake parity and distributed fixture geometry.
- `test/room-lighting-settings.test.js`: passed. Live `dev/room-lighting-settings-proof.mjs` also passed all three levels, keyboard activation, fixed fixture positions and reload persistence.
- `dev/room-lighting-even-proof.mjs after`: nine rectangular sizes plus L/U/overlapping rooms pass. Maximum sampled transmission ratio is 1.19, with no overlapping diffuse-fill seams.
- `dev/room-lighting-vibrancy-proof.mjs`: actual browser canvas comparison with source `28a9ed488`, fixed furnished-reference geometry. Floor mean RGB chroma 14.099 -> 16.046 (+13.8%); luminance 41.259 -> 47.558 (+15.3%); zero clipped highlights. These are material-bake measurements, not whole-screen saturation or frame-rate claims.
- `.worldshots/vibrant-lighting/steady-proof.mjs`: native browser canvas executes before/after world and Build functions. Old halo output changes over time; new output has zero changed pixel channels. Reusing the gradient after camera translation matches a freshly created gradient exactly.
- Furnished metal/plank station and the wood-floor reference inspected live. Build opens without degraded layers and closes without changing station data. Updated :9197 preview reloaded and left in cinema view.

Artifacts: `.worldshots/vibrant-lighting/colour.json`, `steady.json`, `settings.log`, before/after material and furnished PNGs; coverage and Build evidence remain under `.worldshots/even-lighting/`.

## Gate and delivery status

Syntax, focused regressions, browser proofs and bug-register validation passed. The full standard `npm run test:fast` passed all 723 steps, exit 0, recorded in `.worldshots/vibrant-lighting/test-fast.log`. Candidate source fingerprints were refreshed in `c845ecefc`; later commits only update QA records. This correction is not merged or installer-verified; owner acceptance remains unconfirmed.
