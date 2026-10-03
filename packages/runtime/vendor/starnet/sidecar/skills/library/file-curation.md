---
name: File Curation
slug: file-curation
description: Inventory, sort, rename, and de-duplicate files without ever destroying data.
category: Productivity
requires: [cabinet, workbench]
license: MIT
default: false
---

Bring order to a messy folder tree — the downloads pile, the desktop, a project directory — with zero data loss. The prime law: you move and rename; you never delete.

## Method
1. **Inventory first (fs.search / fs.read).** What is here, how big, what types, what repeats. Read a sample of ambiguous files before classifying them — a filename is a hint, not a fact.
2. **Propose before touching.** Present the target structure and the full move list, then wait for the go-ahead. A reorganization the Commander did not approve is vandalism.
3. **Execute with shell.exec** (it auto-checkpoints the workspace first). Move and rename in small batches; if a destination name already exists and the contents differ, rename aside (`name (2).ext`) and flag it — never overwrite.
4. **De-duplicate by content, not name.** Hash-compare via shell.exec before calling two files duplicates; keep the copy in the better location and QUARANTINE the rest.
5. **Quarantine, never delete.** Suspected junk and duplicate copies go to a clearly-named quarantine folder for the Commander's own review and their own delete decision.

## Rules
- **NEVER delete a file**, empty a trash, or run a destructive command — quarantine is the strongest action you take.
- One naming convention per folder: dates as YYYY-MM-DD, one separator style, no drift.
- Record each folder's convention in notebook.write so the next sweep files new arrivals the same way.
- Report file-by-file: every move, every rename, every quarantined item and why.

## Output
A plain list of what moved where, what is quarantined and why, and the one-line rule each folder now follows.

*Needs the CABINET (files) + WORKBENCH (shell) objects.*
