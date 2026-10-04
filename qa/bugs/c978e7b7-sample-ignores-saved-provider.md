---
fingerprint: c978e7b7
slug: sample-ignores-saved-provider
title: Doctor works but sample ignores the saved provider
surface: providers
severity: P1
status: fixed
found: 2026-09-04
lane: reliability-followup
fix: e33914cb2
origin: customer
report: support-2026-09-04-sample-ignores-saved-provider
affected: Exact affected build/platform not recorded in sanitized evidence
family: execution-configuration
installer: unverified
recovery: unconfirmed
---

# Doctor works but sample ignores the saved provider

## Symptom

A configured agent passes Doctor but the sample says the provider is unconfigured.

## Repro

Save a managed entry dock and custom BYOK second dock without an environment default. Run the drawn sample, restart, and run again.

## Evidence

docs/EMAIL_BUG_FOLLOWUP_2026-09-04.md; test/routing.sample-provider.e2e.test.js; source fix e33914cb2

## Verdict

Source repair is present. Installer behavior and customer recovery remain unverified; run the customer journey and release checks before changing those outcomes.

## Regression

Before e33914cb2, sample execution omitted each roster provider/model. Afterward the strict two-dock upstream observes each intended credential and model; an absent roster model refuses without spending.

## Sibling coverage

{
  "adapters": [
    {"target":"starnet","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved starnet configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"openrouter","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved openrouter configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"custom","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved custom configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"gemini","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved gemini configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"codex","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved codex configuration, successful tool and second inference; direct, routine and sample; two boots","gate":"http"},
    {"target":"native Anthropic","state":"covered","test":"test/provider-recovery.e2e.test.js","scenario":"Real native tool round-trip and compaction after credential failover","gate":"http"}
  ],
  "entrypoints": [
    {"target":"direct/routine/sample","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Thirty complete local sidecar journeys","gate":"http"},
    {"target":"delegation","state":"covered","test":"test/e2e.dispatch-session.test.js","scenario":"Worker result reaches Commander session","gate":"http"},
    {"target":"Telegram","state":"covered","test":"test/channels.telegram.e2e.test.js","scenario":"Real channel ingress and reply against loopback services","gate":"http"},
    {"target":"every adapter on delegation and Telegram","state":"blocked","reason":"Existing ingress/delegation suites cover representative configurations; the five-adapter cross-product is not yet implemented."},
    {"target":"mixed-provider drawn sample","state":"covered","test":"test/routing.sample-provider.e2e.test.js","scenario":"Managed entry and BYOK downstream keep distinct credentials after restart","gate":"http"}
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
