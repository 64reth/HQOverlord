# Customer reliability campaign

Run `npm run qa:customer-journeys` from an isolated worktree. It uses the existing sequential
test runner, isolated profiles and loopback provider services. It does not use live customer
credentials. New coverage is also registered in the normal HTTP/fast gates.
The PR/trunk `fast-gate.yml` and tagged `release-train.yml` workflows both execute this
focused campaign after the fast gate. The fast gate checks that this wiring remains present.

## Complete local execution journey

`test/customer-journey.e2e.test.js` drives the production sidecar through five provider paths:
managed StarNet, OpenRouter BYOK, custom compatible BYOK, native Gemini and Codex OAuth.
For each, save a roster/model and routine, connect using the real desktop key push seam
(managed link and Codex token stores are fixtures), execute a sample, direct task and routine,
perform a real filesystem tool call, send its result to a second inference, and require final
output. Restart the process, re-push desktop keys as the shell does, then reuse the saved
roster and routine and repeat. That is 30 execution journeys, not 30 users or models.

Strict upstream simulators check exact model/auth routing, Gemini opaque signatures and
tool-call/result pairing. A text-only probe cannot satisfy this test. Background title/summary
inferences are answered separately because they can outlive their initiating run.

The focused campaign also exercises existing regressions:

| Gap | Executed scenario |
| --- | --- |
| Different entry paths choose different credentials | Managed entry/custom downstream sample, no default model, restart, absent-model refusal |
| Managed account mistaken for BYOK billing identity | Linked zero wallet permits BYOK without debit; managed request refuses |
| Repair one adapter and miss siblings | OpenRouter/compatible/Codex malformed history; Gemini metadata; credential failover during compaction |
| Output exists but is not delivered | Delegated worker to Commander session, channel ingress/reply, routine transcript |
| Persistence proved without recovery | Saved routing restart, station recovery, expired OAuth, connector session recovery |
| UI offers the wrong recovery | Tier catalog and connector state regressions |

## Live UI and release acceptance

On an isolated seeded station (`node dev/seed.js --keep`), run
`node dev/email-support-live-proof.mjs` with `EMAIL_PROOF_URL` and `EMAIL_PROOF_CDP` set
to its local ports. It creates an ONCE routine through the DOM and injects lost acknowledgement,
missing readback, stale arm-state and duplicate cases. It requires truthful messages and retained
drafts. Restart the same seed with `--keep`; run the proof with `--restart` to require exactly
one saved routine visible in Active Routines. Use a new scratch station for each campaign.

Local mocks establish harness behavior. They do not prove provider account allowance, a
production relay deployment, OAuth login through a real account, OS keychain persistence,
sleep/wake, or renderer behavior on an installed Mac/Windows build. The full five-provider
cross-product on delegation and Telegram is also still a coverage gap; existing tests exercise
representative paths. These limits remain explicit in the bug records.
Native Anthropic has real tool/failover/compaction coverage in `provider-recovery.e2e`, but
its full three-entry/two-boot matrix, and other compatible provider identities, still need
the same expansion. They are named coverage gaps rather than inferred from the five paths.

For each affected release candidate, the release lane must use the exact installer, record its
version and SHA-256, reproduce the same operation through the visible UI, inject the relevant
failure, follow the offered recovery, restart and repeat. Reuse `qa:model` for the live
provider tool smoke and the existing installed-provider soak for its supported scope; neither
alone proves the full customer journey. Attach behavior receipts to `installerEvidence`.
Only an actual reporter retest advances `recovery` to confirmed.

## Feedback loop

File every customer/owner escape in `qa/bugs` with its original report, affected build,
failure family, reproduction and the sibling review. Split distinct symptoms in one support
thread; avoid duplicating the same symptom across email and GitHub. Engineering closure,
installer verification and customer recovery are independent columns in `qa/BUGS.md`.
Uncorrelated failures stay open even if a neighboring source fix appears plausible.
