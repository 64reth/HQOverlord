# Email bug follow-up — 2026-09-04

Scope: close uncovered engineering gaps from the support-mail review without reimplementing or
merging another lane's fixes. Reporter identities and private diagnostics are deliberately omitted.

## Ownership and integration

- Lane: `agent/email-gaps-0904`, based on `cd8a56a4c`.
- Sample-run provider selection and tier-catalog fixes are already in that baseline; do not merge them again.
- OpenRouter pairing (`449d8b331`), provider/model reconciliation (`42649dd81`), and linked/quota
  status (`756ebec88`) are already integrated. This lane extends pairing coverage, not their branches.
- `agent/value-loop-0904` owns first-value/discovery, work presentation and recurring-session
  transcript metadata. Coordination confirmed no overlap with INBOX creation or provider adapters.
- That lane handed off after its post-merge gates passed. Its trunk commit `c0a2ca521` was merged
  into this lane without conflicts. Preserve unrelated integration-tree edits.

## Reproduced gaps repaired here

1. **Managed-compatible tool history.** The generic Chat Completions adapter, used by managed
   StarNet, forwarded an orphan tool result with an empty call id. A local HTTP upstream enforcing
   the pair invariant returned `400 — Tool message must have either name or tool_call_id`.
   The existing direct-OpenRouter repair now lives once in `providers/provider.js`, and both
   adapters use it. Orphan information is retained as explicitly labeled recovery text; interrupted
   calls get explicitly labeled missing results. Valid histories stay unchanged. No automatic
   tool execution is added. This does **not** prove the cause of the historical managed Sonnet 5 error.

2. **INBOX routine confirmation.** Arm scheduling, open the INBOX form, disarm scheduling in
   another view, then create an ONCE job: the old UI said `routine scheduled` while GET `/api/cron`
   said `enabled:false`. Creation now checks HTTP status, the acknowledgement and exact job id,
   then reads the same list as AUTOMATION before confirming. Current arm/halt/job state decides
   the message. Missing readback and lost responses retain the draft and say to check AUTOMATION
   before retrying. They cannot claim either success or that nothing was created.

3. **Concurrent connector session recovery (found by the merge gate).** The first post-merge HTTP
   gate exposed a delayed sibling response being cancelled when the replacement MCP session finished
   connecting. The candidate merge was backed out before investigation. A deterministic two-caller
   HTTP reproduction failed before the fix. Retired clients now drain pending replies or their existing
   timeouts before closing; normal disconnects still close immediately. Both calls recover through one
   re-initialization. Client lifetime checks cover late responses, refusal of new requests and timeout cleanup.

## Evidence

- Initial combined-code pre-merge gates: `npm run test:fast` **707/707** and `npm run test:http` **92/92**, exit 0.
  The first post-merge HTTP gate then exposed the MCP race above; that merge was backed out. Final
  gates must include its repair before integration is considered complete.
- Subsequent verification exposed a moving-HEAD assertion in the loop undo test. It now inspects
  the exact `undoCommit` returned by the operation; checks were not weakened. A workshop deliverable
  timeout passed its standalone 65-assertion rerun; it still requires a green full HTTP gate.
- Under concurrent full-suite load, the workspace-lease test's 500 ms head start let the intended
  waiter acquire first. Its fixture now waits for the holder's actual write and uses an explicit
  release barrier. All 13 assertions pass, including no write before the lease handoff.
- Final pre-merge verification: repaired product code passed fast **707/707**; the complete HTTP
  suite with both test synchronization corrections passed **92/92**, including workshop **65/65**.
- The live restart proof also passed after incorporating `c0a2ca521`.
- Before/after local HTTP adapter reproduction: malformed request rejected before; labeled recovery
  accepted afterward, with `Recovered` text and a normal finish.
- Provider adapter assertions: OpenRouter 64; compatible 79, including strict pair validation,
  original-history immutability and valid-history preservation.
- Real sidecar `/api/run` integration: 55 assertions; compatible endpoint recovery includes
  the original evidence and a reconciled cost event.
- `node dev/email-support-live-proof.mjs` against an isolated `node dev/seed.js --keep` station:
  scheduler off, stale arm snapshot, response lost after durable save, missing readback row,
  and duplicate refusal all passed. Failure cases kept the draft; no false success.
- After restarting that sidecar, `node dev/email-support-live-proof.mjs --restart` proved exactly
  one `EMAIL ONCE PERSISTENCE` job, `runsLine:true`, `schedule.kind:once`, visible in Active Routines.
- The reported ONCE disappearance itself did not reproduce on current trunk. Duplicate/deleted-name
  refusal fixes were already present. Do not claim this lane reproduced historical data loss.

## Remaining support/release distinctions

| Report class | Engineering disposition | Evidence still needed |
| --- | --- | --- |
| Sample provider / tier catalog | Previously merged; no duplicate merge | Next public installer and reporter retest |
| Direct OpenRouter malformed history | Previously merged; extended here to compatible adapter | Reporter retest of exact routed workflow |
| Linked warning vs quota exhaustion | Previously merged | Provider allowance/credit recovery is separate from UI repair |
| Gemini thought signatures | In v0.10.13 | Reporter retest |
| Blank viewport / false zero-credit banner | Matching fixes in v0.10.13 | Reporter retest |
| Managed model selection / empty catalog | Existing provider-truth fix retained | Production route and customer retest |
| INBOX ONCE routine absent | Current creation/list/restart proven; receipt race repaired here | Customer diagnostics if absence persists |
| Idle agents / high usage | No customer-specific billing defect established | Run receipts, model, enabled routines/loops/night shift, and expected work cadence |
| Beginner setup / connecting work sources | Owned by value-loop lane | Actual customer workflow validation |

The idle/spend report supplied no run ledger or diagnostic block. The seeded idle station reports
`idle — awaiting orders`; this is not evidence of a failed scheduler. Existing scheduling, budget,
and billing controls must be tested rather than replacing idle with invented activity or imposing
new default quotas. A generic assertion that BYOK is always more expensive is not justified.

The exact managed-service HTTP 400 remains uncorrelated: `flyctl auth whoami` reports no access
token. Local cloud main already contains sanitized upstream trace commit `b83271e`; a merged
source commit is not deployment proof. Production logs/access or a current request id are required.
No customer account, credential, cloud deployment, release publication, or support email was changed.

Full merge-gate results and the final trunk SHA belong in the integration digest once earned.
