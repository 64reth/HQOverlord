---
fingerprint: 2b6d70fb
slug: byok-blocked-by-empty-managed-wallet
title: Valid BYOK wake is blocked by an empty managed wallet
surface: providers
severity: P1
status: fixed
found: 2026-08-28
lane: reliability-followup
fix: 5b5f50a1d
origin: customer
report: https://github.com/androoAGI/starnet/issues/6
affected: Reported before v0.10.13; installer recovery unverified
family: execution-configuration
installer: unverified
recovery: unconfirmed
---

# Valid BYOK wake is blocked by an empty managed wallet

## Symptom

A linked account with zero managed credit cannot wake using its own valid provider key.

## Repro

Link a station to a zero-balance managed account, select a custom BYOK provider and run; repeat as managed StarNet.

## Evidence

docs/EMAIL_BUG_FOLLOWUP_2026-09-04.md; test/sidecar.http.test.js; source fix 5b5f50a1d

## Verdict

Source repair is present. Installer behavior and customer recovery remain unverified; run the customer journey and release checks before changing those outcomes.

## Regression

Before 5b5f50a1d admission gated BYOK on the managed wallet. The zero-wallet sidecar HTTP scenario proves BYOK succeeds without managed debit/credit while managed inference refuses.

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
    {"target":"customer desktop and physical Mac","state":"blocked","reason":"Source-side receipts are not a visual or installed-binary proof. Run the release journey on supported hardware."}
  ],
  "lifecycle": [
    {"target":"restart","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"Saved roster and routines reused after sidecar restart; desktop key push repeated; OAuth store retained","gate":"http"},
    {"target":"sleep, network change and physical keychain","state":"blocked","reason":"A process restart with fixture credentials does not exercise OS suspend or an installed keychain."},
    {"target":"linked zero wallet","state":"covered","test":"test/sidecar.http.test.js","scenario":"BYOK success with no wallet debit and managed refusal","gate":"http"},
    {"target":"native Anthropic and other provider identities across every entry","state":"blocked","reason":"The complete three-entry/two-boot matrix covers the five named paths. Native Anthropic has failover/compaction coverage; other compatible provider identities and native Anthropic still need that full matrix."}
  ]
}
