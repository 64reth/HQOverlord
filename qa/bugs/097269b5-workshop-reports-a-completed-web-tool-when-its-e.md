---
fingerprint: 097269b5
slug: workshop-reports-a-completed-web-tool-when-its-e
title: Workshop reports a completed web tool when its entry file is missing
surface: sessions
severity: P1
status: fixed
found: 2026-09-06
lane: agent/release-ui-audit-0906
fix: 44a8c3006
origin: audit
---

# Workshop reports a completed web tool when its entry file is missing

## Symptom

A queued web-tool build can report `reason: built` and retain the title and instructions
for a runnable HTML tool even when `index.html` was never written. The library then has
only a README. This is an existing validator defect exposed during the September 6
merge audit, not a confirmed regression introduced by the latest visual changes.

## Repro

1. Run the seeded real-sidecar journey suite (`npm run qa:journeys`). J4 queues a web
   tool and writes `index.html`, `README.md`, then `deliverable.json` through `fs.write`.
2. Interrupt or delay the HTML write beyond the tool's ten-second deadline while
   allowing the README and manifest writes to complete. The manifest lists both files.
3. Read `workshop.shift.result`: it still reports `reason: built`, with only README in
   its normalized manifest. J4's `manifest-lists-index-html` assertion fails.

The timing trigger was observed under shared-host load and is intermittent. The
deterministic validator condition is a manifest listing one present and one missing
file: the missing member is discarded instead of rejecting the incomplete build.

## Evidence

Audited trunk: `d107e5ef2`. Live full-suite log in the isolated audit worktree:
`.bugloops/release-ui-audit-0906/release-audit-journeys.log`, with these consecutive assertions:

    PASS J4/deliverable-built — fired=true reason=built runId=a258114f-000a-4f8d-9bb6-f05286acbe0a
    FAIL J4/manifest-lists-index-html — manifest files: [{"path":"README.md","bytes":33}]
    JOURNEYS FAIL (exit 3) — 121/122 assertions passed

The isolated J4 repeat passed its HTML check but lost README instead. Its retained
`runs.jsonl` records `h2 fs_write isError:true summary:timeout ms:10368`; only the HTML
and manifest exist. That illustrates why the passing focused receipt does not close
the bug. No installed-desktop proof was performed.

Source anchor: `sidecar/index.js:12200`, `validateWorkshopManifest`. Each missing or
rejected member uses `continue`; only an entirely empty `provenFiles` array fails.
The title, summary and how-to text remain those of the complete claimed artifact.
`git blame` attributes this filtering to `f576c99c37` (July 3), predating this UI batch.
Current automated detection: `scripts/qa/journeys.mjs` J4 checks index.html, but does
not require every declared file to have been written successfully.

## Verdict

Source fixed by `44a8c3006` on the release preparation lane. Every declared member must
validate as a real file; missing, rejected and non-file members invalidate completion.
Partial files stay on disk. The existing no-manifest failure/retry path remains visible
and never marks the build complete. Installed-desktop acceptance is still unverified.

## Regression

On 2026-09-06, the real-sidecar `test/workshop.e2e.test.js` reproduction emitted seven
failing assertions before the repair: both missing-entrypoint and missing-support-file
builds returned built, returned a partial success manifest, and failed to stay visibly
failed; the durable SSE also advertised an incomplete build. After repair, all 86
assertions pass, including two attempts per incomplete build, preserved surviving files,
no built response/event, and a failed library record surviving a real sidecar restart.
The full browser journey suite also passes 130/130 on `5f66ccb47`.
Logs: release preparation worktree `workshop-before.log`, `workshop-after.log`,
`journeys-release.log`. This is source/runtime evidence, not installer certification.

## Sibling coverage

{
  "adapters": [{"target":"Workshop filesystem manifest validator","state":"covered","test":"test/workshop.e2e.test.js","scenario":"missing entrypoint and support file reject completion while complete builds remain valid","gate":"http"}],
  "entrypoints": [{"target":"queued Workshop shift and retry","state":"covered","test":"test/workshop.e2e.test.js","scenario":"two incomplete attempts fail instead of marking built","gate":"http"},{"target":"implement and Night Shift use the same validator","state":"blocked","reason":"Shared validator is repaired; independent fault injection for incomplete implement and Night Shift builds remains a coverage gap."}],
  "displays": [{"target":"shift response, durable SSE and deliverable library","state":"covered","test":"test/workshop.e2e.test.js","scenario":"no partial success manifest or built event; failed row remains visible","gate":"http"}],
  "lifecycle": [{"target":"partial files and failed library records","state":"covered","test":"test/workshop.e2e.test.js","scenario":"recoverable files remain on disk and failed records survive real sidecar restart","gate":"http"}]
}
