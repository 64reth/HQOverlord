# Room colour parity with the approved 9197 preview

The owner's approved screenshot is the 9197 preview on LOW room lighting with the amber camera grade. The 0.11.0 installed profile instead had a custom phosphor theme (hue 92, saturation 100) and MEDIUM room lighting. The original lighting merge `772ac7e` is an ancestor of the version-bump commit `b858516cd`; loose installed lighting source matches that release. That ancestry/file comparison alone does not prove the executable's embedded frontend.

The colour discrepancy was reproduced in the running preview with LOW held constant: AMBER produces `saturate(1.06) contrast(1.1) brightness(0.94)` on `#stage`, while CUSTOM produces `saturate(0.72) contrast(1.08) brightness(0.88)`. The UI theme was desaturating the already-lit scene. The room light distribution and glow constants were present.

Source fix `ba3e66447` applies the approved camera filter directly to `#stage`, independently of the UI palette. The website mirror is identical. No room light sources, exposure mappings, materials, bloom, motion, or text rendering changed. Preset and custom UI colours remain independently adjustable.

Live browser proof after the fix:

| UI theme | Panel phosphor | Station filter | Room level |
| --- | --- | --- | --- |
| Amber | #ffaa33 | saturate(1.06) contrast(1.1) brightness(0.94) | LOW |
| Green | #3dff70 | same approved filter | LOW |
| Blue | #46c8ff | same approved filter | LOW |
| Purple | #b46bff | same approved filter | LOW |
| Red | #ff4136 | same approved filter | LOW |
| White | #e8f0e8 | same approved filter | LOW |
| Custom hue 92 / saturation 100 | #92ff33 | same approved filter, including after reload | LOW |

LOW -> MEDIUM -> HIGH -> LOW preserves the same grade with the selected control changing correctly. Reload retains custom hue 92, saturation 100, LOW and the approved grade. Cinema view was visually inspected against the supplied two-room screenshot; warm furniture/floor colours and corridor pools are present. This is a colour-grade match, not a claim that changing viewport size, camera position, animated scenery or room exposure yields identical screenshots.

Focused checks passed: simulation-lighting 84 assertions, custom-phosphor 36 assertions, room-lighting-settings, syntax and diff checks. Full merge-gate results are recorded below when complete. Exact installed-artifact verification belongs to the release task's rebuild; it must select LOW for the owner's reference comparison, preserve the custom UI colour, and verify the computed station grade after reload. Existing user-selected brightness levels are deliberately preserved by the code.

Release coordination: `Prepare StarNet 0.11.0 update` was informed of the defect, exact CSS rule and brightness difference and asked to include the merged fix before the next installer. No installed data or executable was modified by this lane.

Branch gate: `npm run test:fast` completed all 727 steps, exit 0, at source/claims HEAD `67db050e3`. Log: `.worldshots/room-colour-fast.log`. Subsequent lane changes only record this proof and close the source bug; installed verification and owner recovery remain pending.
