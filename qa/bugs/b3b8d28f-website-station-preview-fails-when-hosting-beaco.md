---
fingerprint: b3b8d28f
slug: website-station-preview-fails-when-hosting-beaco
title: Website station preview fails when hosting beacon is blocked
surface: world
severity: P1
status: fixed
found: 2026-09-05
lane: website-station-boot-0905
fix: 27560918e
origin: owner
report: owner-supplied-screenshot-2026-09-05-website-station-boot
affected: starnetos.com live preview observed 2026-09-05 in Chrome; exact deployed source revision unknown
family: deployment-integrity
installer: not-applicable
installerEvidence: Website-only repair; no desktop installer contains or serves starnetos.com.
recovery: unconfirmed
---

# Website station preview fails when hosting beacon is blocked

## Symptom

The starnetos.com live station is replaced by a full-screen `STATION FAILED TO BOOT` diagnostic that
names Cloudflare's injected `beacon.min.js` as the script that did not load, so the station itself is
not visible.

## Repro

1. Stage the website with `npm run website:stage` and serve `website-deploy/`.
2. Append a failing `/beacon.min.js/v31ed6d6f95cf4e85b04c19e7a9bdbcba1788362987495` script to
   `app/embed.htm`, matching the hosting-layer resource reported in the owner's screenshot.
3. Load the homepage and wait for the embedded station's DOMContentLoaded boot check.
4. Before the repair, `#bootguard-fatal` is present and names the beacon even though the station modules loaded.

## Evidence

Owner screenshot 2026-09-05; `frontend/app/bootguard.js`; `test/bootguard.test.js`;
`test/website-deploy-staging.test.js`. The before-fix focused regression failed three assertions because
the beacon created a fatal banner. The staged live reproduction reported both the hosting beacon and a
missing `/shared/specialties.js`; the latter file was absent from the exact upload tree.

## Regression

Before `3947ea71c`, every failed script element was treated as station-critical, so a blocked hosting
analytics tag fired the fatal boot screen. After that commit, only authored `app/`, `js/`, and `shared/`
module failures define boot health; the exact beacon is ignored while app and shared failures remain fatal.
Commit `27560918e` also stages the authoritative shared specialty catalog and advances the demo/document
revision so returning visitors receive the complete current preview. Focused coverage is 56 boot-guard,
24 deploy-staging, 15 live-preview, and 8 mirror assertions.

## Sibling coverage

{
  "adapters": [
    {"target":"hosting-injected script","state":"covered","test":"test/bootguard.test.js","scenario":"blocked Cloudflare beacon cannot become a station boot failure","gate":"fast"},
    {"target":"station-owned app/js/shared modules","state":"covered","test":"test/bootguard.test.js","scenario":"real app and shared script failures still render the fatal diagnostic","gate":"fast"}
  ],
  "entrypoints": [
    {"target":"homepage app/embed.htm","state":"covered","test":"test/website-deploy-staging.test.js","scenario":"dashboard-safe embed and required shared catalog are present in the staged upload","gate":"fast"},
    {"target":"direct app/index.html","state":"covered","test":"test/website-app-sync.test.js","scenario":"generated website app stays synchronized with the production frontend","gate":"fast"}
  ],
  "displays": [
    {"target":"staged homepage iframe","state":"covered","test":"test/website-live-preview.test.js","scenario":"homepage targets the current cache-revisioned staged station document","gate":"fast"},
    {"target":"production starnetos.com","state":"blocked","reason":"The source repair is not customer recovery; Cloudflare direct upload must deploy the merged staged tree and the owner must retest it."}
  ],
  "lifecycle": [
    {"target":"returning visitor cache/localStorage","state":"covered","test":"test/website-live-preview.test.js","scenario":"new demo revision refreshes an obsolete saved website preview exactly once","gate":"fast"},
    {"target":"desktop application boot","state":"not-applicable","reason":"The reported failure is caused by a hosting-injected website script; the packaged desktop does not load that tag."}
  ]
}

## Verdict

Source-fixed by `3947ea71c` and `27560918e`. The guard now preserves loud diagnostics for genuine station
modules without letting optional host instrumentation define station health, and the deploy artifact now
contains the previously omitted shared catalog. Production deployment and owner recovery remain explicit,
separate follow-ups.
