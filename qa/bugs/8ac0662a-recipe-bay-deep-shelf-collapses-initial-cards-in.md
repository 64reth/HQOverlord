---
fingerprint: 8ac0662a
slug: recipe-bay-deep-shelf-collapses-initial-cards-in
title: Recipe Bay deep shelf collapses initial cards into slivers
surface: world
severity: P2
status: fixed
found: 2026-09-06
lane: release-0110
fix: fe5be77a9
origin: owner
report: Owner 0.11.0 installer test, 2026-09-06, image 2
affected: Windows 0.11.0 candidate 2cfdcb04e
family: recipe-layout
installer: unverified
recovery: unconfirmed
---

# Recipe Bay deep shelf collapses initial cards into slivers

## Symptom

Recipe Bay recommendation cards collapse into thin strips with unreadable stacked text at the left of the horizontal shelf.

## Repro

1. Open Recipe Bay with at least six recommendations.
2. Use a roughly 463px-wide recommendation rail.
3. Inspect the first three cards and horizontal scrolling.

## Evidence

Owner screenshot 2 (2026-09-06). Live :9188 DOM before: rail 463px, grid columns 0px 0px 0px 232px 232px 232px, first three buttons 16px wide and 251px high. After excluding .mkt-rail-deep in all four later recruit/recipe grid rules: six 232px columns, all cards 98px high. Anchor: frontend/css/marketplace.css:865.

## Verdict

Source repair fe5be77a9 is implemented and live proof is recorded. Exact installer behavior and owner recovery remain unverified.

## Regression

Live browser reproduced the collapsed first three cards. After the repair, the same six-offer fixture shows six equal 232px cards in a contained horizontal shelf. Both recruitment and recipe-specific overrides now preserve deep rails.

## Sibling coverage

{
  "adapters": [
    {
      "target": "CSS cascade",
      "state": "blocked",
      "reason": "This is a source CSS fix, manually proved through computed grid geometry; no registered visual test specifically asserts the six-offer layout."
    }
  ],
  "entrypoints": [
    {
      "target": "Recipe Bay deep rail",
      "state": "blocked",
      "reason": "Six offers were tested in the live seeded Recipe Bay at 463px."
    },
    {
      "target": "Recruitment deep rail",
      "state": "blocked",
      "reason": "The shared conflicting recruitment rule is fixed; an independent recruitment six-offer runtime fixture remains untested."
    }
  ],
  "displays": [
    {
      "target": "Windows browser",
      "state": "blocked",
      "reason": "Source layout was inspected at the reported narrow width; new installer retest remains pending."
    },
    {
      "target": "macOS WebView",
      "state": "blocked",
      "reason": "Physical Mac unavailable."
    }
  ],
  "lifecycle": [
    {
      "target": "reload and topic count changes",
      "state": "blocked",
      "reason": "Reload was verified manually with six saved topics; different topic counts rely on existing grid behavior and remain outside the focused live fixture."
    }
  ]
}
