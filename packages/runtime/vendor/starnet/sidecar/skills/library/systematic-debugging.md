---
name: Systematic Debugging
slug: systematic-debugging
description: Find the root cause with a tight red→green feedback loop before attempting any fix.
category: Engineering
requires: [workbench]
license: MIT
default: false
---

Random fixes waste time and spawn new bugs. Find the root cause FIRST.

## The Iron Law
```
NO FIX WITHOUT ROOT-CAUSE INVESTIGATION FIRST
```
This matters most exactly when you're under time pressure, when "just one quick fix" looks obvious, or when a previous fix didn't work — that's when guessing costs the most.

## The feedback loop IS the work
Before theorizing from code, build a **tight** command that goes RED on the exact symptom and GREEN when it's fixed. Tight = fast, deterministic, runnable by you (`verify.run` / `shell.exec`), and specific enough to catch THIS bug — not merely "doesn't crash". When a clean repro is hard, spend disproportionate effort building the loop; guessing without a red-capable loop is the failure this skill exists to prevent.

Ways to build the loop, roughly in order: a failing test at the seam that reaches the bug → a curl/HTTP script against a dev server → a CLI invocation diffing output → a headless-browser assertion → replay a captured trace → a throwaway harness booting the smallest failing slice.

## The four phases (finish each before the next)
1. **Investigate.** Read the error and the FULL stack trace (line numbers, paths, codes) — it often names the cause. fs.search the error string. Build the red loop. Not reproducible? Gather more data; do not guess.
2. **Hypothesize.** State ONE concrete theory of the root cause that explains the red loop.
3. **Fix the cause, not the symptom.** Make the smallest change that turns the loop green. If you're swallowing an error, adding a retry, or special-casing a value, stop — that's a symptom patch, not a root-cause fix.
4. **Verify.** Loop goes green, then run the FULL suite to prove no regression. Keep the loop as a regression test.

*Needs the WORKBENCH object to run the loop.*
