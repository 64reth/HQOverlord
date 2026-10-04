# SWEEP · sessions — workstreams, projects, transcripts, save and restore

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `sessions`.
**Rank 4 of 10** — this is the surface where a bug destroys work the Commander cannot get back.

## What you own

`sidecar/runstore.js` · `transcriptstore.js` · `savestore.js` · `durable-store.js` ·
`durable-write.js` · `projects-store.js` · `projectscan.js` · `threads-store.js` ·
`checkpoint-store.js` · `deliverable-store.js` · `workspace-lease.js` ·
`frontend/app/autosessions.js` · `backup.js` · `cloudsave.js` · `legacymigrate.js`

## The failure states to walk

1. **Restart is the only real proof.** Do the thing → restart the sidecar → is the state still
   true? Do it for every mutation you can reach: rename, delete, revoke, pin, archive, restore.
   Persistence bugs are the most-repeated class in this repo's history.
2. **Kill mid-write.** Interrupt during a save (close the app, kill the process, fill the
   target dir). Does it restore the last good state, or a half-written one? `durable-write.js`
   claims the guarantee — prove it, don't read it.
3. **Deleted is not gone.** Tombstoned sessions revive only via an OUTBOX click. Walk delete →
   restart → search → outbox and prove nothing resurrects by any other route, and that nothing
   the Commander expects to survive is silently swallowed.
4. **A revoked project is READ-ONLY.** Two bugs already shipped here: `+ NEW` still minting a
   session in an untrusted root, and an armed "Forget" that announced removal and left the row.
   Re-walk the whole PROJECTS rail after a revoke: create, enter, browse, forget, restart.
5. **Two writers, one store.** Two runs, two workstreams, or two windows mutating the same
   session at once. Last-write-wins is acceptable *if it is honest*; silent loss is not.
6. **Workstream identity under switching.** Switch workstreams during and after a run. Do COMMS
   identity, run metadata, title and status stay scoped to the right stream? A crossed title is
   the visible tip of a crossed store.
7. **The board must equal the store.** Taskboard rows must be exactly the `kind:'task'`
   workstreams — no chat, no summon, nothing stuck IN PROGRESS forever. Drive real runs and
   compare the rendered board against the backend store at every step, not once at the end.
8. **Transcript truth.** After a halt, a crash and a restart, does the transcript show what
   actually happened, including the halt? A transcript that quietly ends is a lie.

## Done means

Every claim proven across a real `--keep` restart, and every destructive control (delete,
forget, revoke, archive) walked to its end state twice — once accepted, once refused.
