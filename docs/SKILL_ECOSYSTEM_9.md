# Skill library and distribution ecosystem — 9/10 release contract

StarNet already has unusually strong **skillbuilding**: agents distill procedures from completed work,
load them progressively, track use, patch and curate them, and withhold risky content behind an exact-byte
approval gate. The weak side of the comparison with Hermes Agent is **distribution**. Before this lane,
there was no supported path from an open `SKILL.md` into that lifecycle.

This plan treats 9/10 as a product contract, not a feature count. A skill ecosystem is excellent when a
beginner can discover or receive a skill, understand exactly what will enter the agent, install it without
losing package bytes, keep it current or roll it back, and share their own work — while the harness never
claims trust, readiness, or currency it cannot prove.

## Scorecard

| Dimension | Weight | Trunk before this lane | 9/10 release bar |
| --- | ---: | ---: | --- |
| Learning and authoring loop | 20 | 17 | Creation, reflection, editing, curation, quality feedback, and portable authoring guidance |
| Runtime usefulness | 15 | 13 | Progressive disclosure, deterministic activation, usage evidence, and capability-aware readiness |
| Inbound distribution | 20 | 2 | Direct URL/GitHub, well-known discovery, registry search, and complete multi-file package installs |
| Outbound distribution | 10 | 1 | Export/publish a standards-compatible package with provenance and validation |
| Trust and lifecycle safety | 20 | 17 | Inspect-first staging, SSRF/size/path controls, package scan, exact-byte approvals, updates, and rollback |
| Human experience and operations | 15 | 8 | Searchable library, understandable provenance, update status, failure recovery, and measurable reliability |
| **Total** | **100** | **58** | **90+ with no safety or package-fidelity exception** |

## Delivery slices

### S1 — trustworthy direct distribution (implemented in `agent/skill-ecosystem-9`)

- Accept a public HTTPS `SKILL.md` or a pasted GitHub file URL.
- Reuse StarNet's URL and DNS guards, revalidating every redirect; cap documents and stages.
- Parse the open Agent Skills `name` + `description` contract.
- Show source URL, SHA-256, full instructions, and sanitized guard findings before install.
- Freeze reviewed bytes in a bounded ten-minute stage so install cannot re-fetch different content.
- Persist source URL, digest, version, author, license, and fetch time on the ordinary owned skill.
- Treat community cautions as quarantined/approvable and dangerous content as non-installable.
- Check the original source for updates and require a second full preview before applying one.
- Preserve long real-world skill documents up to the package ceiling; never retain a digest for silently
  truncated instructions.
- Prove authenticated routes, update-in-place, refusal, and disk replay through a real sidecar restart.

S1 closes the dangerous architectural gap and raises the distribution subsystem materially, but it does
**not** by itself earn 9/10. This first direct-URL path is explicitly limited to one `SKILL.md` document.

### S2 — complete packages and discovery (next)

- Install the complete `SKILL.md` folder from GitHub, skills.sh detail responses, and well-known indexes,
  including bounded `references/`, `scripts/`, `assets/`, and `templates/` with one package digest.
- Refuse a partial install when referenced package files cannot be fetched; never label it ready.
- Add cached search/browse for configured registries, curated/official provenance, duplicate/fork signals,
  upstream audit metadata, and per-source availability/error truth.
- Add user-managed registry/tap sources with community trust by default.

### S3 — publishing, updates, and recovery

- Validate and export an owned skill as a standards-compatible folder/archive without losing support files.
- Add a publish/share handoff that produces a manifest and instructions but never silently uploads.
- Store update generations and expose inspectable rollback; pinned skills remain update-locked.
- Separate upstream version/digest from locally edited forks and make that divergence visible.

### S4 — quality and 9/10 certification

- Add trigger and outcome evaluations, usefulness/acceptance signals, and stale/broken-source telemetry.
- Measure install success, update success, quarantine rate, rollback success, package-fidelity failures, and
  time-to-first-use without sending private skill content.
- Certify direct, GitHub, well-known, and registry journeys in the live app; include offline/source-down,
  redirect, oversized package, malicious package, restart, update, rollback, and export re-import cases.
- Re-score only from verified behavior. The lane reaches 9/10 when the weighted score is at least 90 and
  every trust/package-fidelity hardline above is green.

## Locked product rules

- Skills remain **HOW**; Recipes remain **WHAT**; Routines remain **WHEN**.
- Installing never grants missing tools or gear. A procedure and a capability are separate truths.
- No grind, level, or XP gate controls skill access.
- No registry badge substitutes for StarNet's own scan and exact-content review.
- A failed fetch, scan, persistence write, or update check is unknown/refused — never “safe,” “installed,”
  or “up to date.”
