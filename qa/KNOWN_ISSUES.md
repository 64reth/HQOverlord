# QA — KNOWN ISSUES baseline

Human-readable baseline of defects the QA crew already knows about. Every fingerprint
listed here is **suppressed**: the ledger refuses to file it again (anti-nag law, Part 5).
`scripts/qa/ledger.mjs` scrapes each `fingerprint:` token below, so keeping this list in
sync with reality is all that's needed to silence a known defect — no second data file.

Seeded from `docs/SELF_TEST_STATION_PLAN.md` Part 1 ("known-baseline findings"),
verified against trunk `feat/harness-backend` on 2026-07-01.

To retire a baseline entry (a real fix landed): delete its row here and the crew will
file it fresh if it recurs. To add a new known-good exception: append a row with a
`fingerprint:` computed via `node scripts/qa/ledger.mjs --dedup-check`, or from
`fingerprintOf({ crew, checkId, subject })`.

| Crew | Check | Subject | Fingerprint | Notes |
| --- | --- | --- | --- | --- |
| Visual Auditor | VA-3 | Undimmed floor/COMMS behind some centered modals | `fingerprint: cede9189` | Cosmetic scrim gap; tracked, not a blocker. |
| Visual Auditor | VA-6 | Modal content clipping | `fingerprint: 138b3b47` | Content overflow in some centered modals. |
| Truth Auditor | audit-placeholder-key | Placeholder-key audit artifact #1 | `fingerprint: d7a25032` | Expected artifact when `npm run audit` runs with a placeholder key. |
| Truth Auditor | audit-placeholder-key | Placeholder-key audit artifact #2 | `fingerprint: d6a24e9f` | Second expected placeholder-key artifact. |
| Truth Auditor | audit-stale-selector | Stale `.mkt-primary` selector in `scripts/audit.mjs` scenarioSummon | `fingerprint: dd20e6ee` | Part-1 baseline entry. **Q3 VERDICT (2026-07-01, lane qa-truth):** RE-VERIFIED against trunk — `scripts/audit.mjs` `scenarioSummon` already targets `.mkt-cta-main.mkt-deploy` (lines 192, 194); there is NO `.mkt-primary` anywhere in `scripts/audit.mjs`, and `marketplace.js` emits `.mkt-cta-main.mkt-deploy` (line 357). A repo-wide grep for `mkt-primary` finds it ONLY in this file + `docs/SELF_TEST_STATION_PLAN.md` + `docs/session-status/session-6-builder-bake.md` — it is fully retired from BOTH audit.mjs AND product code (`frontend/`). No fix was needed in the audit script. The `.mkt-cta-main.mkt-deploy` selector is exercised live and green in every `npm run audit` run (`summon/bay-open` PASS). Kept here so any REGRESSION that re-introduces the stale selector in audit.mjs still doesn't re-nag under this fingerprint. |

## How suppression works

The ledger's pure core computes `fingerprint = FNV-1a(normalize(crew) + normalize(checkId) + normalize(subject))`.
A finding whose fingerprint appears above (or whose on-disk `status` is `known`/`dismissed`)
is **refused** on `--add` with a loud message and a nonzero exit — it never files a second time.
