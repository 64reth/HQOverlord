# SWEEP · autonomy — cron, routines, Night Shift, loops, unattended truth

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `autonomy`.
**Rank 5 of 10** — everything here runs while nobody is watching, so every bug is discovered
late and every dishonest status is believed.

## What you own

`sidecar/cron.js` · `cron-driver.js` · `cron-guard.js` · `cron-lock.js` · `cron-store.js` ·
`nightshift.js` · `nightshift-driver.js` · `nightfocus.js` · `nightpatch.js` ·
`loop.js` · `loopjob*.js` · `loopgit.js` · `autonomy-ledger.js` · `auxgovernor.js` ·
`questsweeps.js` · `frontend/app/autonomy*.js` · `autojobs*.js` · `autopilot*.js`

## The failure states to walk

1. **Time is the adversary.** DST boundaries both directions, a clock jump, a machine asleep
   through a fire, a one-shot that should never re-fire, a cron expression that cannot parse.
   Assert: no double-fire, no dropped result, no stale "fired" claim.
2. **Restart between fire and settlement.** Kill the sidecar after a routine fires but before
   its result lands. On reboot: is the run resumed, honestly abandoned, or silently claimed
   complete? The third is a P0.
3. **A disabled scheduler must SAY it is disabled.** Turn the scheduler off and leave routines
   armed. Every surface that shows a "next run" must now show the truth. A next-run time that
   will never arrive is the purest form of the lie this product exists not to tell.
4. **Locks under contention.** Two drivers, one job. Force the lock to be contended and prove
   exactly one runs. Then crash the holder and prove the lock is releasable, not permanently
   poisoned.
5. **A poll must never spend a model turn; only a change may.** Walk every watcher and count
   the model calls it makes on an idle tick. Any non-zero is a money bug.
6. **Budget and halt while unattended.** Trip a Night Shift budget cap and a halt mid-beat. Does
   work in flight die cleanly, and does the ledger record what was actually spent, not what was
   planned?
7. **Approve/reject is real.** The LOOP system's approve/reject path was recently made real —
   walk it end to end, including rejecting after the work already landed, and approving twice.
8. **Grant scoping overnight.** Night Shift grants are meant to be bounded. Grant, sleep past
   the boundary, and try to use it. Then revoke mid-beat.

## The trap that governs this whole lane

**Before trusting any regression test here, revert the fix and watch it go red.** A retry, a
backoff or a swallowing catch will make a test pass for the wrong reason — an autonomy test
that has never been seen to fail is proving nothing.

## Done means

Deterministic replay first (pure cron tests, fake clock, mocked provider), THEN a seeded live
routine. A finding without a deterministic repro is not finished — this surface cannot be
debugged from a one-time observation.
