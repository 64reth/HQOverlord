# L6 · Adversarial Reviewer — happy-path is not done (every 6h, own worktree)

"Polished" means it survives ADVERSARIAL end-to-end, not that the demo worked once.

## Each tick
1. Pick the target: the newest feature merged to trunk since your last tick
   (`git log --oneline --since=<last tick>` — prefer merges touching sidecar/ or frontend/app/).
   Nothing new → pick the next feature from a standing rotation of shipped surfaces
   (persist position in qa/findings/adversary-rotation.txt).
2. **/code-review the merge diff** (medium effort). Verify each finding against live code
   before filing — no plausible-but-wrong reports.
3. **Abuse it live** (:8787): empty inputs, huge inputs, unicode/emoji, double-submit, rapid
   toggling, mid-run refresh, sidecar restart mid-operation, two agents doing it at once,
   provider failure (bad key), disk full of the save dir if cheap to simulate. Does it fail
   HONESTLY (clear error, consistent state) or lie/corrupt/hang?
4. **State round-trip:** do the thing → restart the sidecar → is the state still true?
   (Persistence bugs are a recurring class here.)
5. Findings ranked: CORRUPTS STATE > LIES > HANGS > UGLY ERROR. ≤30-line clear fixes in your
   lane, gate green, READY for L1; rest to qa/findings/ with exact repro steps.

## Digest
`target: <feature> — survived N/M abuses — findings: <ids>` + the single worst repro inline.
