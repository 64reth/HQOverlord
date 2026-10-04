# Group chat deeper QA — 2026-09-05

Final runtime candidate: `72f3982d3`; frontend/source lock: `5a623a54f`.
Integrated runtime trunk snapshot: `152d1fab3`; subsequent test-port-only trunk update `c2a62eeb9` also included.
Worktree: `C:/Users/andro/gen-trees/group-dm-plan-0904`.

## Defects found and corrected

1. Explicit Retry after restart left the group paused and the new turn queued forever.
   Regression failed with actual queued versus expected completed. Retry now clears
   the paused/halted state after validating the retry target. Live proof: interrupted
   ENGINEER turn `8c612cc4-8cc1-4828-b9fd-1ae50a520993` was retried through the RETRY
   button; the new turn completed with RETRY COMPLETE.
2. Duplicate display names made an exact autocomplete ID ambiguous. Regression failed
   for @peer when two participants were named Peer. Exact stable IDs now take precedence;
   ambiguous display-name-only references still reject rather than guessing.
3. A stopped question could be revived in an agent's prose because the context omitted
   its canceled state. The observed older session contained exactly that reply after
   the user said hey. Context now includes the coordinator's pending/answered/canceled
   question state and explicitly explains that canceled questions need no answer.
4. A restarted service could show a raw JSON parse error for its expired browser token.
   Group requests now explain that refreshing reconnects and that conversation is saved.
   This exact message was observed after the live crash/restart.

## Additional regression coverage

`test/group-sessions.edge.test.js` is part of the fast manifest. It covers explicit
retry after persisted interruption, duplicate display names and exact IDs, canceled
question context, removing a member during a question, late-answer rejection,
wrong-group question and file access, and @all completing once per participant.
The normal group unit and real-host HTTP suites also passed independently.

## Live checks

Deep-test group: `ws_mtopse4vb5gs`, separate from the user's previous test session.
- Three chosen members created through the native picker.
- Uploaded group-shared-proof.txt using the ordinary attachment button. RESEARCHER
  invoked group.read and returned the exact answer violet. The shared preview showed
  the exact contents and hash prefix a5129e733640. Artifact persisted across restart.
- Unsent GROUP DRAFT survived switching to direct OK session and back; response stayed
  in the correct group transcript.
- Hard restart during a running ENGINEER request produced interrupted, never completed.
  RETRY actually resumed and completed, with a new turn linked to the interrupted one.
- A 1 MiB + 1-byte attachment was rejected with an actionable message, retaining both
  draft and file; no message or run was dispatched. Removed file normally afterward.
- @all produced exactly NOVA, RESEARCHER, and ENGINEER responses, attributed separately.
- Normal Stop canceled a fresh Tea/Coffee question before a subsequent status question.

## Full gates

**718 fast steps and 97 HTTP steps passed**, sequentially with unchanged full manifests
and 1200-second outer deadlines. Combined wrapper exit: zero. Logs:
`dev/group-final-qa-fast.log` and `dev/group-final-qa-http.log`.
The final runtime includes the latest merged reliability changes. A post-gate trunk
change only isolates test ports in channels.telegram.e2e.test.js; the affected test
is rerun separately in the hermetic HTTP manifest runner. No runtime change followed
the complete green gates.

## Scope of assessment

This is feature merge-readiness QA, not an installed desktop or station-wide release
certification. Watchdog long thresholds use deterministic fault injection. Provider
outputs remain variable: tests prove routing, state and isolation, not universal model
compliance. No merge to trunk or release performed. Preview remains on port 9137 with
isolated existing scratch state; latest launcher PID 51484 (rediscover child if stopping).

Post-fix live question proof: RESEARCHER answered that no question was pending and
explicitly identified Tea/Coffee as canceled; no question card remained. Browser
warning/error log was empty. Uploaded oversized file was removed through its normal
attachment control; only the 51-byte shared proof file exists in the group's artifacts.

Full gate attempt 1 found a stale source-window assertion in agent-model-select.test.js:
load() still refreshed the header, but the test only searched its first 3600 characters.
Replaced the arbitrary window with a function-boundary match; 65 assertions passed.
Final rerun logs are `dev/group-deep-fast-final.log` and
`dev/group-deep-http-final.log`; source bytes remain unchanged from the live proof.


The second stale source-window test, comms-history-pin.test.js, now checks call order
within the load function. The full remaining fast-test section passed 261 steps before
the final complete 718-step green rerun. The final combined candidate served a real
LOCAL CHECK OK group reply after restart, with no pending states or browser errors.

Final supplemental test: channels.telegram.e2e.test passed 60 assertions through the
hermetic runner (1/1). At closure the worktree is clean, current trunk is contained,
and port 9137 returns HTTP 200. Recommendation: feature is ready to merge; no remaining
blocking defect found in this QA scope. Trunk merge and installed-release proof have
not been performed by this lane.
