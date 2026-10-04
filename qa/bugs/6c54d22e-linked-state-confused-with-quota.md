---
fingerprint: 6c54d22e
slug: linked-state-confused-with-quota
title: Linked account warning confuses provider quota with disconnection
surface: providers
severity: P1
status: fixed
found: 2026-09-01
lane: reliability-followup
fix: 756ebec88
origin: customer
report: support-2026-09-01-linked-state-confused-with-quota
affected: Exact affected build/platform not recorded in sanitized evidence
family: recovery-truth
installer: unverified
recovery: unconfirmed
---

# Linked account warning confuses provider quota with disconnection

## Symptom

Settings says linked while a prompt suggests linking again; diagnostics show provider allowance errors.

## Repro

Use a linked station with exhausted Codex/Grok allowance and classify the provider error plus linked-state display.

## Evidence

docs/EMAIL_BUG_FOLLOWUP_2026-09-04.md; test/genesis-starnet-link.test.js; source fix 756ebec88

## Verdict

Source repair is present. Installer behavior and customer recovery remain unverified; run the customer journey and release checks before changing those outcomes.

## Regression

The linked/quota convergence commit distinguishes linked state from exhausted allowance. genesis-starnet-link, errorclass and friendlyerror protect these presentation/classification rules. It does not replenish a provider subscription.

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
    {"target":"every adapter on delegation and Telegram","state":"blocked","reason":"Existing ingress/delegation suites cover representative configurations; the five-adapter cross-product is not yet implemented."}
  ],
  "displays": [
    {"target":"stream and sample output","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Success requires a tool result, normal terminal event and final output","gate":"http"},
    {"target":"customer desktop and physical Mac","state":"blocked","reason":"Source-side receipts are not a visual or installed-binary proof. Run the release journey on supported hardware."},
    {"target":"linked label","state":"covered","test":"test/genesis-starnet-link.test.js","scenario":"Linked UI derives current linked state","gate":"fast"},
    {"target":"quota recovery copy","state":"covered","test":"test/friendlyerror.test.js","scenario":"Allowance errors do not prescribe relinking","gate":"fast"}
  ],
  "lifecycle": [
    {"target":"restart","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved roster and routines reused after sidecar restart; desktop key push repeated; OAuth store retained","gate":"http"},
    {"target":"sleep, network change and physical keychain","state":"blocked","reason":"A process restart with fixture credentials does not exercise OS suspend or an installed keychain."},
    {"target":"native Anthropic and other provider identities across every entry","state":"blocked","reason":"The complete three-entry/two-boot matrix covers the five named paths. Native Anthropic has failover/compaction coverage; other compatible provider identities and native Anthropic still need that full matrix."}
  ]
}
