# SWEEP · skills — skills, recipes, routines, the guard, the marketplace

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `skills`.
**Rank 6 of 10** — this surface accepts content from outside the station and hands it to a
model, which makes it the one place a content bug becomes a security bug.

## What you own

`sidecar/skills/` (`guard.js`, `gate.js`) · `skillstore.js` · `skillcurator.js` ·
`skillreview.js` · `plugins.js` · `harness-import.js` · `usercommands.js` ·
`slash.js` / `slash-actions.js` · `frontend/app/marketplace.js` · recipe + routine surfaces

## The locked vocabulary (do not blur it)

**Skills = HOW · Recipes = WHAT · Routines = WHEN.** A surface that mixes them is a bug even if
it works.

## The failure states to walk

1. **The bytes delivered are not the bytes scanned.** `hydrate()` overrides a stored body from
   disk, so an edited `SKILL.md` can launder content past the scanner. Re-digest at the delivery
   seam. Walk: create clean → edit the file on disk to something dangerous → use it. Then walk a
   legacy record written before the guard existed.
2. **An approval blesses BYTES, not a name.** Approve a skill, edit it, use it again — it must
   re-ask. Restart the sidecar and prove the approval survived, keyed to the digest.
3. **Only the bytes that reach the provider can prove a prompt block was skipped.** Assert on
   the composed system prompt, not on a store. Two traps: **one `/api/run` POST produces MORE
   than one upstream call** (aux self-talk and session titling land in the same capture — take
   the window and pick the run by its `[RUNTIME]` marker), and **a mock model must advertise
   `supported_parameters:['tools']`** or the run is refused before composing anything.
4. **A withheld skill is NAMED, never summarized.** Hiding the row entirely makes the model
   create a same-named skill, which `manage()` then refuses as a duplicate — a silent gate that
   manufactures a confusing refusal two turns later.
5. **Tiers are not interchangeable.** `user`-authored content ASKS; `trusted`/`community`
   content BLOCKS. Prove the Commander can still write `rm -rf` into their own procedure
   deliberately, and that content arriving with someone else's vetting claim cannot.
6. **Every content action respects `pinned`.** All six of them, including the `skill.write`
   wrapper. A human override needs an explicit `force`.
7. **Package limits.** File-count cap, total-byte cap, symlink redirect on write, no
   link-following in `hydrate`. Try each. A zip bomb, a 10k-file package, a symlink to
   `~/.ssh`.
8. **Install and discovery.** The known-open gap is the "New skill" composer and the
   install/ecosystem path — walk it as a beginner and record where it dead-ends.

## The law this lane exists to enforce

**Grep the CONSUMER, not the producer.** `skillstore.persist()` stamped a security verdict on
every saved skill and *nothing read it* — the scanner called a skill dangerous and it was
indexed, preloaded and served in full anyway. Before trusting ANY check on this surface, grep
who reads its output.

## Done means

Every gate proven by reverting it and watching a test go red, and every content path proven at
the delivery seam rather than at the store.
