---
name: Spec Drafting
slug: spec-drafting
description: Turn a fuzzy idea into something buildable — the smallest version that is genuinely useful, with acceptance criteria and the cuts named.
category: Planning
requires: [cabinet]
license: MIT
default: false
---

Most ideas fail at the point where "what I want" has to become "what gets built". The job is to make the idea decidable: testable criteria, explicit scope, and the edge cases surfaced before they become rework.

## Method
1. **Write the one-sentence outcome.** Who it is for, what changes for them, and how you would know it worked. If this sentence resists being written, the idea is not ready and everything downstream is guesswork.
2. **Find the smallest genuinely useful version.** Not a demo, not a stub — the least that a real person could use and benefit from. Everything else becomes "later", explicitly.
3. **Write acceptance criteria as observable behaviour:** "given X, when the user does Y, then Z". If a criterion cannot be checked by someone who did not build it, rewrite it.
4. **Surface the edge cases now** — empty state, the failure path, the very large input, the concurrent user, the offline case. Each gets a decided answer or an explicit "out of scope".
5. **Name the open questions and who decides them.** An unowned question stalls a build.
6. **Read the existing code or docs with fs.read** when the idea touches something that already exists — a spec that contradicts the current system is worse than none. Save the spec with fs.write.

## Rules
- **Every criterion is testable.** "Fast", "intuitive", and "robust" are not criteria; "loads in under 2s on a cold cache" is.
- **The cuts are part of the spec.** An unstated exclusion gets built anyway and blows the estimate.
- **Never invent a requirement the Commander did not state** — mark inferences as assumptions and flag them for confirmation.
- Prefer one decided answer over a menu of options; note the runner-up and why it lost.

## Output
The outcome sentence, the smallest useful scope, the acceptance criteria, the edge cases with their decisions, then the explicit cuts and the open questions with owners.

*Needs the CABINET (reading what exists, writing the spec).*
