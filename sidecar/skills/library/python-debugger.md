---
name: Python Debugger
slug: python-debugger
description: Step through Python with pdb and debugpy — breakpoints, scope inspection, and post-mortem on the crash site.
category: Engineering
requires: [workbench]
license: MIT
default: false
---

Three tools, picked by situation. **Start with `breakpoint()`** — it's the cheapest thing that works.

| Tool | When |
|---|---|
| `breakpoint()` + pdb | Local, interactive. Drop `breakpoint()` in the source, run normally, get a REPL at that line. |
| `python -m pdb script.py` | Launch a script under pdb with no source edits. |
| `debugpy` | Remote / headless / attach-to-running. Scriptable; works on long-lived processes. |

## When to use it
- A test fails and the traceback doesn't reveal why a value is wrong.
- You need to watch a collection mutate step by step.
- Post-mortem: an exception fired and you want to inspect locals at the crash site.

Don't reach for it when `print` / `logging.debug` solves it in a minute, or when `pytest -vv --tb=long --showlocals` already reveals it.

## pdb quick reference (at the `(Pdb)` prompt)
- `n` step over · `s` step in · `r` run to return · `c` continue · `q` quit
- `l` list source · `ll` list whole function · `w` where (stack) · `u`/`d` move up/down the stack
- `p expr` / `pp expr` print/pretty-print any expression in the current frame
- `b file:line` set breakpoint · `b file:line, cond` conditional · `cl` clear
- `!statement` run arbitrary Python in the frame (e.g. mutate a var to test a fix)

## Post-mortem (inspect the crash)
```bash
python -m pdb -c continue script.py   # runs, drops into pdb at the uncaught exception
```
Or in code: after an exception, `import pdb; pdb.post_mortem()` puts you at the failing frame with all locals live.

## debugpy (headless / already-running)
```bash
python -m debugpy --listen 5678 --wait-for-client script.py
```
Then attach a DAP client. Use for a daemon/gateway you can't restart.

## Method
Break at the seam where the value first looks wrong, not the crash line. Print the suspects, step forward, and stop at the first line where reality diverges from your expectation — that's the bug.

*Needs the WORKBENCH object to run python under a debugger.*
