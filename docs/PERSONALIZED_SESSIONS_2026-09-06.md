# Personalized session recommendations

Owner correction: basic task templates and recency shortcuts do not satisfy an agent that understands its user. Preserve the approved vertical layout; replace the recommendation mechanism. The follow-up explicitly retains three ambitious general defaults: build a working tool, remove a recurring burden, and pressure-test a major decision.

Done means: in the seeded running app, two distinct work histories produce different evidence-backed session briefs; new requests and goals invalidate old proposals; dismissals survive reload; an unavailable model or insufficient context offers the three substantial general defaults without pretending they are personalized; selecting a proposal prepares the correct session with its context; only the explicitly associated run receives outcome attribution. Focused regressions and the full fast gate must pass before merge.

The recommendation input combines current user requests, results, active goals and milestones, learned ambitions/pain/preferences, capabilities, and recommendation feedback. Zero to three is a ceiling, never a quota. A continuation needs unfinished work, not merely recent activity. Substantial deliverables and explicit recurring burdens are eligible from the first meaningful request. Starting work remains an explicit send of the prepared brief.

Implemented in the isolated worktree. The owner subsequently authorized the merge. Synchronized with trunk 076d6769b; full test:fast passed all 726 steps and test:http passed all 101 steps on 2386b6e4c. The live seeded UI was rechecked after synchronization: stacked, left-aligned cards, no overflow, personalized cookbook continuation, and no browser warnings/errors. No installer or release build was produced.

Verified in the seeded running app on port 9296 with a local deterministic provider on 9396 (no real inference credentials or quota):

- All three defaults appear as compact vertical cards. Selecting Build a working tool creates a named session and prepares its full brief without sending it.
- A concrete revenue-dashboard request reaches the internal evidence-generation route. Its returned cohort-validation suggestion shows the reason and deliverable, and selecting it restores the original conversation and its full cited request in the composer.
- Dismissing the personalized suggestion restores the three general defaults; reload preserves the dismissal.
- New request content invalidates the cached context. The generator receives the newer cookbook priority separately from the previous dashboard request; the live UI changes to Create the cookbook print-ready layout. Saved feedback is hydrated before generation, preventing an initial zero-weight request from being immediately invalidated during boot.
- Live testing exposed internal recommendation runs being crated as unattended user work. Returns now excludes the existing internal flag; contextpack also excludes it from evidence about the user. Both have regressions.

Focused checks passed: starters (37 assertions), starterstore (28), contextpack (35), returns (29), profile (61), recommendation ledger (26), source/release mirror (35), bug-register validation, and git diff --check. The website mirror is synchronized.

Limits: generated wording in the live test was a deterministic fixture, not a real model quality evaluation. The mock catalog initially lacked task-tool metadata, so the test task attempts failed before execution; no delivered task or successful real-provider run is claimed. Installed desktop and real-provider quality verification remain pending.

The first full fast run exposed an overly broad source-text assertion in beat-coordination.test.js: it matched the new card's "to review" copy instead of routeProposalBatch. The guard now scopes itself to that handler (124 assertions pass), and the complete fast suite was rerun successfully. This test-only correction leaves product behavior unchanged. Gate logs: dev/.scratch-workspace/merge-fast.log and merge-http.log. Synced live screenshot: dev/.scratch-workspace/session-ideas-merge-proof.png.

Local screenshots: dev/.scratch-workspace/session-ideas-defaults.png and session-ideas-personalized.png. Provider request evidence: dev/.scratch-workspace/session-ideas-requests.jsonl (all are ignored QA artifacts).
