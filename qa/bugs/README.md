# qa/bugs — the durable bug register

One **tracked** markdown file per bug: `<fingerprint>-<slug>.md`. `../BUGS.md` is the
**generated** index over this directory — never hand-edit it, rebuild it.

## Why this exists next to `qa/findings/`

They are different spines and both are needed:

| | `qa/findings/*.json` | `qa/bugs/*.md` (here) |
| --- | --- | --- |
| Written by | detector **scripts** (`scripts/qa/ledger.mjs`) | **sweep lanes** (agents/humans) |
| Tracked in git? | **No** — machine-local | **Yes** — travels with the repo |
| Lifetime | one machine, one run | forever, across worktrees and sessions |
| Job | "did trunk just regress?" | "what is still wrong, and who owns it?" |

Findings are gitignored on purpose: their `evidence[]` paths are absolute `.bugloops/`
artifacts and their triage is ephemeral. That is correct for a detector and fatal for a
hunt — when ten lanes sweep in ten worktrees, every lane re-finds the same defects and
everything dies with the session. **This directory is the hunt's shared memory.**

## Why one file per bug

A single appended register is a hotfile: ten lanes appending rows conflict on every merge.
Distinct filenames never conflict. `../BUGS.md` is generated, so a conflict there is
resolved by regenerating it, never by hand.

## Commands

```bash
node scripts/qa/bugs.mjs --new --title "..." --surface channels --severity P1 --lane sweep/channels
```

```bash
node scripts/qa/bugs.mjs --list --status open --surface channels
```

```bash
node scripts/qa/bugs.mjs --set <fingerprint> --status fixed --fix <commit-sha>
```

```bash
node scripts/qa/bugs.mjs --validate
```

`--validate` runs in `test:fast` (`test/qa-bugs.test.js` guards the logic;
`test/qa-bugs-register.test.js` guards the real on-disk register), so the register cannot rot.

## The laws it enforces

1. **Evidence** — every bug carries a non-empty `## Evidence`. No artifact, no bug.
2. **Repro** — every bug carries a non-empty `## Repro`. A defect nobody can re-trigger can
   never be proven fixed.
3. **No-fake-fixed** — `status: fixed` requires a non-empty `fix:` commit.
4. **Verdict** — `wontfix`/`duplicate` require a written `## Verdict`. A bug leaves the
   backlog fixed, or argued out of it in writing.
5. **Filename authority** — the filename must be `<fingerprint>-<slug>.md` and the
   frontmatter must agree.
6. **No duplicates**, and no `open` bug whose fingerprint sits on the `../KNOWN_ISSUES.md`
   baseline (anti-nag — accept it or retire the baseline row).
7. **Anchor** (records found on/after 2026-08-21) — a bug names at least one thing a machine
   can re-check on the current tree: a test path (`test/x.test.js`), a `file:line`
   (`sidecar/x.js:123`), or the defective code quoted in backticks. `npm run qa:reconcile`
   (`scripts/qa/ledger-reconcile.mjs`) re-checks those anchors and reports which open records
   are already fixed on trunk; an anchor-less record can only ever be closed by a human
   re-reading it, which is how the register drifted stale. Older records are grandfathered
   and listed by the report for back-fill.

Identity is **(surface + slug)**, frozen at creation. Re-wording a title never re-keys a bug.

## Customer and owner reports (from 2026-09-05)

Classify new records with `origin: customer|owner|audit|unknown`. An unknown origin cannot
close as fixed. Older unclassified records remain historical evidence, not a customer census.
Keep one record per symptom; an email and GitHub copy of the same report share one record.
Use sanitized report references or public issue links. Never commit customer names, addresses,
tokens, raw diagnostics, or private mailbox URLs.

Customer/owner records require `report` (source), `affected` (build/platform, or explicitly
unknown), `family`, `installer` and `recovery`. The three outcomes mean different things:

| Outcome | Required evidence |
| --- | --- |
| `status: fixed` | `fix` commit; `## Regression` describing before-fix failure and after-fix proof; four sibling dimensions below |
| `installer: verified` | Source fixed, `installerVersion`, exact 64-character lowercase `installerSha256`, and `installerEvidence` describing behavior on that artifact |
| `recovery: confirmed` | Source fixed and `recoveryEvidence` identifying the reporter's successful retest |
| `recovery: persists` | `recoveryEvidence` identifying the continued failure; this is not inferred from silence |

Defaults are `installer: unverified` and `recovery: unconfirmed`. Tag ancestry, an upstream
issue being closed, and passing source tests cannot advance either outcome. Use
`installer: not-applicable` only with an explanation in `installerEvidence`, such as a
server-only repair. Customer silence remains unconfirmed. Do not relabel a report as an
audit finding to bypass these requirements.

For reported bugs, reconciliation uses the explicit `fix` field as source-fix evidence.
A commit mentioned in a verdict may be a related repair that did not resolve this symptom.
Passing baseline tests or removed files cannot promote an uncorrelated report to likely-fixed.

Before closing a user-reported bug, enumerate **adapters, entrypoints, displays, lifecycle**
in `## Sibling coverage` as JSON (without a code fence):

```json
{
  "adapters": [{"target":"managed-compatible","state":"covered","test":"test/provider.openai-compatible.test.js","scenario":"orphan tool result replay","gate":"fast"}],
  "entrypoints": [{"target":"sample","state":"covered","test":"test/routing.sample-provider.e2e.test.js","scenario":"mixed-provider docks after restart","gate":"http"}],
  "displays": [{"target":"physical Mac","state":"blocked","reason":"The affected hardware is unavailable; release lane must verify the actual installer."}],
  "lifecycle": [{"target":"restart","state":"covered","test":"test/customer-journey.e2e.test.js","scenario":"saved roster and routines reused after process restart","gate":"http"}]
}
```

List each relevant sibling, including untested ones; this example is not a complete review.
`covered` means the **named scenario**, not the whole target. It requires an existing test
registered in the named fast/http gate. `blocked` or `not-applicable` requires a substantive
reason. The validator checks evidence structure and gate membership; a reviewer must still
check that the scenario actually exercises the claim. A blocked sibling remains visible and
does not prevent closing an independently proven source repair.

`--new` accepts the metadata flags; `--set` also accepts `--regression` and `--coverage`
(JSON text). You can edit the record directly, then run `npm run qa:bugs:validate` and
`npm run qa:bugs:index`. The fast gate rejects incomplete closure and a stale generated index.

Run `npm run qa:customer-journeys` for the focused campaign in `test/customer-journeys.list`.
Every included suite also runs in a mandatory fast/http gate; CI cannot silently skip the
new five-adapter journey. See `qa/CUSTOMER_JOURNEYS.md` for the acceptance scope and remaining
external/hardware proof. The September import contains 15 recent symptom records, not a
complete classification of the entire historical register.
