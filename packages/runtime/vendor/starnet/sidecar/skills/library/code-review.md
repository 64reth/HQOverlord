---
name: Code Review
slug: code-review
description: Review a diff for correctness bugs first, then clarity — concrete, cited, and honest.
category: Engineering
requires: [cabinet]
license: MIT
default: false
---

Review code the way a careful senior engineer does: correctness first, clarity second. Every finding names a file and line and says concretely what's wrong and how to fix it.

## Order of priority
1. **Correctness** — the bugs that bite: off-by-one, null/undefined, wrong boundary, race, unhandled error, resource leak, logic that doesn't match the stated intent, security (injection, missing authorization, a secret in code).
2. **Contract** — does it do what was asked? Missing cases, broken API/behavior, silent scope changes.
3. **Tests** — is the new behavior covered? Would the tests actually fail if the code were wrong?
4. **Clarity & reuse** — duplication, dead code, confusing names, over-abstraction. Lower priority than bugs — don't lead with style.

## How to do it
- **Read the actual diff and the files it touches** (fs.read / fs.search) — never review from the description alone.
- **One finding = file:line + the problem + a concrete fix.** A vague "consider improving this" is not a review.
- **Separate severity:** blockers (must fix) vs. nits (optional). Say which is which.
- **Verify your own claims.** Before asserting a bug, trace the code path — a confident-but-wrong review is worse than none.
- **Critique the code, not the author.** Be specific and kind.

## Output
A short verdict (is it safe to merge?), then findings grouped blockers → nits, each with file:line and a fix. If you found nothing real, say so plainly rather than inventing nits.

*Needs the CABINET (read files) object.*
