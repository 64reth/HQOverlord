---
name: Node.js Inspect Debugger
slug: node-inspect-debugger
description: Drive Node's V8 inspector for real breakpoints, stepping, and scope inspection when console.log isn't enough.
category: Engineering
requires: [workbench]
license: MIT
default: false
---

When `console.log` isn't enough, drive Node's built-in inspector from the terminal for real breakpoints, step in/over/out, call-stack walking, scope dumps, and expression evaluation in the paused frame.

**Prefer `node inspect` first** — always available, fast REPL. Reach for CDP scripting only when you need to automate many breakpoints or debug non-interactively.

## When to use it
- A Node test fails and you need to see intermediate state a log can't reach.
- A value lives in a closure `console.log` can't get to without patching source.
- You need a CPU profile or heap snapshot from a running process.

Don't reach for it when `console.log` solves it in under a minute — breakpoint debugging is heavier; use it when the payoff is real.

## `node inspect` REPL
```bash
node inspect app.js        # launches paused on the first line
node inspect -p <pid>      # attach to a running process
```
Inside the REPL:
- `cont` (c) — continue · `next` (n) — step over · `step` (s) — step in · `out` (o) — step out
- `sb('file.js', 42)` — set a breakpoint at a line · `repl` — enter a live REPL in the paused frame to evaluate any expression · `bt` — backtrace · `watch('expr')` / `unwatch`
- `exec('someLocal')` inside the frame prints a local/closure value.

## Scripted (CDP) — when you must automate
Launch with `node --inspect-brk=9229 app.js`, then drive the DevTools protocol from a small script (`chrome-remote-interface`) to set breakpoints, resume, and collect `Runtime.evaluate` / `Debugger.getScopeChain` results across runs. Use this for non-interactive agent loops where you gather state from many breakpoints in one pass.

## Method
Set the breakpoint at the seam where the value first goes wrong (not at the crash site). Step forward one frame at a time, printing the suspect values, until the value diverges from what you expect — that line is the bug.

*Needs the WORKBENCH object to run node and attach the inspector.*
