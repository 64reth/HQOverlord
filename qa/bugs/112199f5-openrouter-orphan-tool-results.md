---
fingerprint: 112199f5
slug: openrouter-orphan-tool-results
title: Routed OpenRouter conversation fails on orphan tool results
surface: providers
severity: P1
status: fixed
found: 2026-09-01
lane: reliability-followup
fix: 14f34372a
origin: customer
report: support-2026-09-01-openrouter-orphan-tool-results
affected: Exact affected build/platform not recorded in sanitized evidence
family: tool-history
installer: unverified
recovery: unconfirmed
---

# Routed OpenRouter conversation fails on orphan tool results

## Symptom

A tool conversation repeatedly fails with invalid tool-call pairing; resetting or switching models does not explain the cause.

## Repro

Replay an orphan result, missing result or duplicate result through the OpenRouter adapter against a strict pair-validating upstream.

## Evidence

docs/EMAIL_BUG_FOLLOWUP_2026-09-04.md; test/provider.openrouter.test.js; source fix 14f34372a

## Verdict

Source repair is present. Installer behavior and customer recovery remain unverified; run the customer journey and release checks before changing those outcomes.

## Regression

Before 14f34372a malformed replay history was sent unchanged and rejected. The regression asserts labeled recovery, matched tool calls and unchanged valid input. 2b976f5f3 subsequently extended the repair to the managed-compatible adapter.

## Sibling coverage

{
  "adapters": [
    {"target":"starnet","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved starnet configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"openrouter","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved openrouter configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"custom","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved custom configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"gemini","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved gemini configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"codex","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved codex configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"OpenRouter replay","state":"covered","test":"test/provider.openrouter.test.js","scenario":"Orphan/missing/duplicate results repaired without mutating valid history","gate":"fast"},
    {"target":"managed-compatible replay","state":"covered","test":"test/provider.openai-compatible.test.js","scenario":"Equivalent malformed tool pairs repaired","gate":"fast"},
    {"target":"Codex replay","state":"covered","test":"test/provider.codex.pairing.test.js","scenario":"Responses call/result pairing","gate":"fast"},
    {"target":"native Anthropic","state":"covered","test":"test/provider-recovery.e2e.test.js","scenario":"Real native tool round-trip and compaction after credential failover","gate":"http"}
  ],
  "entrypoints": [
    {"target":"direct/routine/sample","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Thirty complete local sidecar journeys","gate":"http"},
    {"target":"delegation","state":"covered","test":"test/e2e.dispatch-session.test.js","scenario":"Worker result reaches Commander session","gate":"http"},
    {"target":"Telegram","state":"covered","test":"test/channels.telegram.e2e.test.js","scenario":"Real channel ingress and reply against loopback services","gate":"http"},
    {"target":"every adapter on delegation and Telegram","state":"blocked","reason":"Existing ingress/delegation suites cover representative configurations; the five-adapter cross-product is not yet implemented."}
  ],
  "displays": [
    {"target":"stream and sample output","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Success requires a tool result, normal terminal event and final output","gate":"http"},
    {"target":"customer desktop and physical Mac","state":"blocked","reason":"Source-side receipts are not a visual or installed-binary proof. Run the release journey on supported hardware."}
  ],
  "lifecycle": [
    {"target":"restart","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved roster and routines reused after sidecar restart; desktop key push repeated; OAuth store retained","gate":"http"},
    {"target":"sleep, network change and physical keychain","state":"blocked","reason":"A process restart with fixture credentials does not exercise OS suspend or an installed keychain."},
    {"target":"native Anthropic and other provider identities across every entry","state":"blocked","reason":"The complete three-entry/two-boot matrix covers the five named paths. Native Anthropic has failover/compaction coverage; other compatible provider identities and native Anthropic still need that full matrix."}
  ]
}
