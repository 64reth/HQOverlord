# SWEEP · safecell — consent, permissions, path trust, the files/shell jail

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `safecell`.
**Rank 1 of 10** — a defect here either hands an agent authority it was never granted, or tells
the Commander they are protected when they are not.

## What you own

`sidecar/permissions.js` · `permgrants.js` · `consentwait.js` · `pathtrust.js` ·
`projectbless.js` · `inputpolicy.js` · `inputguard.js` · `taint.js` · `halt.js` ·
`checkpoint.js` · `workspace-lease.js` · `sidecar/tools/` (files/shell/verify/subagents) ·
`frontend/app/` settings + permissions UI · `armconfirm.js`

## The failure states to walk

1. **Grant, then revoke, then use.** Grant a capability, revoke it, and immediately drive a run
   that needs it. Does the run refuse, or does it hold a stale in-memory grant? Restart the
   sidecar between revoke and use and ask again.
2. **The offline lie.** Kill `/api/permissions` (or the whole sidecar) mid-session and reload
   Settings. This exact class already shipped once: the frontend synthesized an empty
   *successful* snapshot and Settings claimed "No standing approvals" while durable grants were
   still being enforced. Re-walk it on every surface that reads an authority: does an
   unreachable endpoint render as *unknown*, or as *empty*? Those must never look the same.
3. **One word, two policies.** The `/approvals` bug was `surface: 'interactive'` carrying both
   "who answers an ungranted mutation" AND "does this run have a real floor". Grep for other
   single flags read by two unrelated consumers — that is a repeatable bug shape, not a
   one-off.
4. **The consent vocabulary.** Decisions are `once` | `session` | `always` | `full`. Anything
   else — including the obvious-looking `allow` — silently becomes DENY. Find every producer of
   a decision string and prove it emits one of the four. A typo here is a silent capability
   loss that reads as a broken tool.
5. **`'full'` writes `'*'`.** A `'full'` decision on ANY consent card is recorded as a wildcard,
   so blessing one connector may bless `shell.exec` too. This is filed as an open product
   question — verify what the code does TODAY before assuming either answer.
6. **Path fuzz.** `..`, symlink ancestors, sibling workspaces, UNC paths, bare drive letters,
   null bytes, a path that is a prefix of a blessed root but not inside it, a blessed root that
   is later deleted and recreated. Assert refusal, not just absence of crash.
7. **Three places drop a grade.** `inputpolicy` / `permissions` / `pathtrust` each independently
   downgrade authority. Prove they agree — a surface that reads only one of them will lie.
8. **Halt and checkpoint under load.** Halt a run with a shell child alive and a background
   process running. Is the child actually dead, or just orphaned and unreported?

## Two traps that have already cost this repo

- **Grep the CONSUMER, not the producer.** `skillstore.persist()` stamped a security verdict on
  every skill for months and *nothing read it*. A stamped verdict nobody consumes is a comment.
- **A catch whose comment says "must never break a run" will hide a dead feature forever.**
  Grep `sidecar/` for swallowing catches on security paths and prove each one has never fired.

## Done means

Every failure state above walked live against a booted sidecar, every finding in the register
with a repro anyone can re-run, and any refusal proven **at the enforcement seam** — never from
a readout. A readout is what lied in the `/approvals` bug in the first place.
