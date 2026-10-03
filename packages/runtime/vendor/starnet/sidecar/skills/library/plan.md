---
name: Make a Plan
slug: plan
description: Think through the approach and write a short plan before writing any code.
category: Planning
requires: []
license: MIT
default: true
---

Before touching code on any non-trivial task, write a short plan. A few minutes of planning prevents hours of rework.

## When to plan
Anything that spans more than one file or a handful of lines, anything with unknowns, or anything the Commander called "build / implement / refactor / migrate". Skip the ceremony for a one-line fix.

## The plan (keep it to a screen)
1. **Goal** — one sentence: what does "done" look like, observably?
2. **Context** — which files/components are involved? Read them first (fs.read / fs.search); never plan against assumptions. List what you actually found.
3. **Approach** — the 3–7 concrete steps, in order. Each step should be independently checkable.
4. **Risks & unknowns** — what might break, what you're unsure about, and how you'll verify it.
5. **Out of scope** — what you are deliberately NOT doing, so scope can't creep silently.

## Rules
- **Read before you plan.** Ground every step in real files, not guesses.
- **Smallest viable slice first.** A thin end-to-end path that works beats a wide half-built one.
- **Surface the plan.** Show the Commander the plan before a big change, so they can redirect cheaply before code exists.
- **One step at a time.** Finish and verify a step before starting the next; update the plan as reality teaches you.
- **Name the verification.** Every plan ends by saying how you'll prove it works (a test, a command, a visible result).

If you have a notebook/todo capability, record the steps as a todo list and check them off as you go.
