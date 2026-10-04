# Group chat integration — 2026-09-05

Owner authorized merging the simple multi-agent COMMS feature. The conversation lane
released the integration window at trunk `368d6a8b9`. Combined runtime candidate
`dc0cf9ecc` contains that trunk snapshot, the earlier deep-QA fixes, and a compatibility
fix for conversational Task Brief questions. Source hash lock and website mirror updated.

## Combined live proof

Seeded local server at http://127.0.0.1:9137/, isolated existing scratch workspace,
real configured provider. Group `ws_mtopse4vb5gs` with NOVA, RESEARCHER, ENGINEER:

- RESEARCHER asked an audience question in conversation mode. The native group card
  displayed its reason and `Draft: A technical report for engineers.` sample.
- Selecting a suggestion placed its text in the existing message box; the question
  remained pending so the user could add context.
- Restarted the sidecar with `node dev/seed.js --keep`; the pending question and sample
  survived. Submitted a full free-form reply through the normal Send control.
- Question `b85c16f0-39b9-4721-b7ef-9832d8118c9e` persisted as answered with the full reply.
  Continuation run `12708ad7-2768-4dcf-acf9-fd5a06b75b60` completed and the transcript
  displayed `AUDIENCE SAVED`. No pending question or turn-state card remained.
- Preview stderr was empty. Previous file-sharing, routing, cancellation, interruption,
  membership and UI evidence is in `GROUP_CHAT_DEEP_QA_2026-09-05.md`.

## Gates

Focused group edge and actual-runOnce HTTP tests passed. Combined pre-merge gates:
721/721 fast and 99/99 HTTP steps green, exit 0. Merged to `feat/harness-backend` as
`6002f57f529dcf5e0c257ae4649966efc64de8fd`. Uninterrupted post-merge gates on that
snapshot also passed 721/721 fast and 99/99 HTTP, exit 0.
Full manifests run sequentially with an explicit 1,200-second outer deadline; no filters
or skipped tests. Logs: `dev/group-premerge-fast.log`, `dev/group-premerge-http.log`.
Post-merge logs: `dev/group-postmerge-fast.log`, `dev/group-postmerge-http.log` in
the retained group worktree. Existing QA status and Rooms handoff bytes were verified
unchanged after merge; only this lane's QA digest is appended afterward. Integration
window released. Preview remains on :9137 with identical production source to the merge;
the worktree is intentionally retained for user testing. Latest launcher PID 42812.

Scope is feature integration. This is not an installed-app or station-wide release
certification. No publish or deployment is authorized by these receipts.
