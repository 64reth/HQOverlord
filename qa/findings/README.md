# QA findings

One JSON file per finding, written at run time by `scripts/qa/ledger.mjs` (schema below).

**Findings are machine-local and git-ignored** (`qa/findings/*.json` in `.gitignore`) — only
this README and a `.gitkeep` are tracked, so a fresh clone gets an empty findings dir. Real
findings accumulate on disk as the crew runs, but they are NOT committed: their `evidence[]`
paths point at gitignored `.bugloops/` output with absolute local paths baked in, and
`dismissed`/`known` triage is ephemeral. The scripts read/create this directory physically via
`fs` (never from git), so ignoring the JSONs does not affect them.

The **durable, portable baseline** that DOES travel with the repo lives elsewhere:
- known-defect suppression → `../KNOWN_ISSUES.md` (tracked; the ledger scrapes its `fingerprint:` tokens).
- re-blessed visual-regression goldens → `scripts/goldens.json` (tracked; so a fresh clone sees no
  regression on frames a session already re-blessed, and files nothing — no need to ship the old dismissals).

**Finding schema** (`qa/findings/<id>.json`):

```json
{
  "id": "…",
  "fingerprint": "…",
  "ts": 0,
  "crew": "Green Guardian | Beginner Run | Truth Auditor | Visual Auditor | Overseer | Janitor",
  "severity": "P0 | P1 | P2",
  "title": "…",
  "detail": "…",
  "evidence": ["path/to/artifact"],
  "status": "open | routed | fixed | dismissed | known",
  "routedTo": "…"
}
```

Laws (Part 5): every finding carries at least one `evidence` path; the same
`fingerprint` never files twice; a `dismissed`/`known` fingerprint never re-files.
Evidence typically lives under `.bugloops/` (gitignored) or alongside the finding.
