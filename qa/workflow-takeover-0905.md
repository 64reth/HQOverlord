# Repeated-work takeover — 2026-09-05

Scope: recognize repeated completed ordinary requests and offer an editable routine through the
existing recommendation slot and scheduler. Three occasions at least 20 hours apart, within 60 days,
are required. Matching is intentionally conservative: a small paraphrase vocabulary, with target,
path, number, negation, project and agent identity retained. This is not broad semantic workflow mining.

Failed, uncertain, internal, attachment-dependent and retry requests do not qualify. A saved
`close` or `missed` rating overrides technical completion. Already scheduled workflows remain
suppressed even when paused. Defer lasts seven days; never is durable. Personalization pause blocks
offers and creation from an offer; forget prevents re-learning the preserved earlier task history.

## Live proof

Ran the full source app using `node dev/seed.js --keep`, port 9196, in this lane's scratch workspace.
A deterministic local OpenRouter-compatible fixture supplied model responses. Two historical
requests (August 22 and 29) were synthetic fixtures; the September 5 request ran through real COMMS,
task briefs, the agent engine and `fs.read`. This is source-app evidence, not installed-build or
production-provider certification.

Observed in the browser:

- The real request read `dev/takeover-client-notes.md` and produced the Acme client update.
- After the work rating, the takeover card cited three separate completed occasions and offered
  review / not now / don't offer again.
- Review opened CREATE ROUTINE with the full original instruction, NOVA selected, and expandable
  dated request evidence. Nothing had been scheduled by opening the review.
- Selected Mondays at 9 AM America/New_York and saved `Weekly client update`.
- Enabled the existing scheduler and used RUN NOW. The scheduler returned the expected Acme update
  and showed `last: ok`.
- Restarted the source app. The job, schedule, prompt, provenance, completed count and successful
  result survived; `/api/workflow-takeovers` returned no candidates.

Job: `8b2d7403-585b-434d-be1e-690f810f5c0a`.
Scheduler run: `07dfa393-9d1f-4b97-ab08-134530932104`.
Takeover: `workflow-f633e98bf2a229018a1d9804`.

Focused coverage: evidence grouping and negative outcomes; one visible offer and stale review;
refused rendering writes no impression; competing notices cannot replace a pending takeover;
authenticated routes; concurrent creation produces one job; restart, pause and forget.

No new execution loop, inferred schedule, automatic access grant, shared event/schema change, or
claim of unattended readiness is introduced. The user reviews instructions, changing dates and
access in the existing form before creation. Full gate results are recorded in the merge digest.

Pre-merge gates: `npm run test:fast` passed all 714 steps; `npm run test:http` passed all 96 steps.
The release surface manifest was refreshed for the reviewed UI changes; existing claim verdicts
and release qualifications remain unchanged. The claims planning authority passes.
