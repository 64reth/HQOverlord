---
fingerprint: b87dbc17
slug: context-extraction-card-uses-a-flat-surface-outs
title: Context extraction card uses a flat surface outside the current theme
surface: sessions
severity: P2
status: fixed
found: 2026-09-06
lane: release-0110
fix: fe5be77a9
origin: owner
report: Owner 0.11.0 installer test, 2026-09-06, image 3
affected: Windows 0.11.0 candidate 2cfdcb04e
family: context-presentation
installer: unverified
recovery: unconfirmed
---

# Context extraction card uses a flat surface outside the current theme

## Symptom

The outlined context extraction card has a flat black fill that does not match the current panel theme.

## Repro

1. Run a task that asks for conversation-mode context through brief_ask.
2. Observe the LET’S SHAPE THIS card, understanding section and text area.
3. Compare those surfaces with the themed surrounding panels.

## Evidence

Owner screenshot 3 (2026-09-06). Live :9188 used a deterministic local provider to issue a real conversation-mode brief_ask. The updated card shows themed layered panel gradients and an inset text area, with no horizontal overflow at 312px or 651px card width. Typed text plus an appended shortcut and Use your judgment produced the folded You shared receipt and completed the mock run. Anchor: test/task-conversation-ui.test.js.

## Verdict

Source repair fe5be77a9 is implemented and live proof is recorded. Exact installer behavior and owner recovery remain unverified.

## Regression

The owner and live pre-fix card showed a flat fill. Source CSS now uses existing panel, face, well, edge and highlight variables while preserving the outline and controls. Existing executable task-conversation tests pass choice append, failed-send text preservation, delegation and folded receipts.

## Sibling coverage

{
  "adapters": [
    {
      "target": "task conversation UI",
      "state": "covered",
      "test": "test/task-conversation-ui.test.js",
      "scenario": "answer and receipt state unchanged by styling",
      "gate": "fast"
    },
    {
      "target": "provider model variants",
      "state": "blocked",
      "reason": "The visual fixture used a local deterministic OpenRouter-compatible provider; real paid-provider behavior was not changed or retested."
    }
  ],
  "entrypoints": [
    {
      "target": "typed answer, shortcuts and delegation",
      "state": "covered",
      "test": "test/task-conversation-ui.test.js",
      "scenario": "append choices, preserve failed text, fold sent context",
      "gate": "fast"
    }
  ],
  "displays": [
    {
      "target": "narrow and wide browser card",
      "state": "blocked",
      "reason": "Live computed styles and overflow checked at 312px and 651px; no registered screenshot test asserts the gradient."
    },
    {
      "target": "installed Windows and Mac",
      "state": "blocked",
      "reason": "New installer and physical Mac acceptance remain pending."
    }
  ],
  "lifecycle": [
    {
      "target": "failed send and decided receipt",
      "state": "covered",
      "test": "test/task-conversation-ui.test.js",
      "scenario": "failure preserves input and accepted context folds without changing content",
      "gate": "fast"
    }
  ]
}
