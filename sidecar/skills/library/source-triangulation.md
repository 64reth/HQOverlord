---
name: Source Triangulation
slug: source-triangulation
description: Confirm a load-bearing claim against multiple independent sources before you assert it.
category: Research
requires: [dish, cabinet]
license: MIT
default: false
---

Before you state a fact that matters, prove it holds across independent sources. One source is a lead, not a fact. Triangulation is how you avoid confidently repeating a single site's error.

## Method
1. **Isolate the claim.** State the exact assertion to verify, and what would make it true or false.
2. **Find independent sources (web_search).** Seek sources that do NOT derive from each other — a primary/official source, an independent report, and a third that is not just re-quoting the first. Aggregators repeating one wire story count as ONE source.
3. **Read each one (web_fetch).** Confirm each actually supports the claim, in its own words and data — not a headline that implies it.
4. **Compare.** Agreement across independent sources → confirmed. Disagreement → report the conflict and which source is more authoritative/recent, do not average it away.
5. **Date it.** Note the as-of date; a fact true last year may be stale now.

## Rules
- **Independence is the whole point** — three copies of one press release is one source. Trace where each got it.
- **A single source → label it "single-sourced / unverified".** Never launder it into a fact.
- **Never fabricate a corroborating source or URL.** If you cannot triangulate, say so.
- Save the confirmed claims and their sources to a file with fs.write when they feed a larger brief.

## Output
Per claim: `confirmed` / `single-sourced` / `conflicting`, the independent sources (linked), and the as-of date.

*Needs the DISH (web) + CABINET (files) objects.*
