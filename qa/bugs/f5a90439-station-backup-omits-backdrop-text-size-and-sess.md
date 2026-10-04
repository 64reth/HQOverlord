---
fingerprint: f5a90439
slug: station-backup-omits-backdrop-text-size-and-sess
title: Station backup omits backdrop text size and session row preferences
surface: world
severity: P2
status: fixed
found: 2026-09-06
lane: agent/release-ui-audit-0906
fix: 336919446
origin: audit
---

# Station backup omits backdrop text size and session row preferences

## Symptom

Importing an exported station reports success but fails to restore the selected
backdrop, text size, and session-row appearance. Theme and room lighting restore,
making this silent partial restoration especially confusing.

## Repro

1. In a seeded station open SETTINGS > APPEARANCE and select ANDROMEDA and HIGH lighting.
2. Open RUNTIME and EXPORT STATION.
3. Select VOID and LOW lighting, then import the exported file through the backup file input.
4. Observe `imported 6 sections`, HIGH lighting, and the incorrect VOID backdrop.
   The same browser-section collector omits textScale and sessionRow.

## Evidence

Live before-fix proof on trunk `d107e5ef2`, isolated seeded sidecar :9186:

    SELECT { lighting: 0.62, backdrop: 'galaxy' }
    EXPORTED settings included roomLighting:'high' but no backdrop/textScale/sessionRow
    RELOADED { lighting: 0.62, backdrop: 'galaxy' }
    RESTORED { lighting: 0.62, backdrop: 'void', message: '✓ imported 6 sections' }

Artifact: `.bugloops/release-ui-audit-0906/release-audit-backup-before.log` in the audit worktree. The production
collector is `browserSections` in `frontend/app/stationui.js:5602`. The executable
regression in `test/settings-p1-ui.test.js` fails before the repair with
`P1-7: backup/import preserves backdrop with void`.

## Verdict

Fixed by `336919446`: include the three omitted browser-owned preferences in
the existing export section; preserve the existing import and legacy-backup behavior.
This omission predates the newest backdrop redesign and was exposed while auditing it.

## Regression

`test/settings-p1-ui.test.js`: before-fix collector assertion fails; after-fix 70/70
assertions pass, including sky/ground IDs and the other appearance preferences.
Live export -> change preferences -> import returned `backdrop:'galaxy', zoom:1.3,
inbox:true, lighting:0.62`. A real sidecar stop, `node dev/seed.js --keep` restart, and
page reload retained exactly those values. Evidence: audit artifacts
`release-audit-backup-all-after.log` and `release-audit-restarted.json`.
The generated website mirror is synchronized. Installed-desktop behavior is unverified.
Frozen candidate `4f338ad8d` passed the complete fast gate (723/723, exit 0) and
complete live journeys (130/130, exit 0).
