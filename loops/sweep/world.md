# SWEEP · world — canvas, props, sprites, windows, COMMS, theming

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `world`.
**Rank 9 of 10** by cost-per-defect, but it is the surface Andrew looks at all day, and the one
where "the app lies" is most visible.

## What you own

`frontend/` canvas + world rendering · props and sprites · windows and panels ·
COMMS surfaces · theming and skins · `frontend/app/lifecycle.js` · `fullscreen.js` ·
`leftrail.js` · `dockglow.js` · `crtlab.js`

**Read `.claude/skills/starnet-frontend-law` before touching anything here.** Those laws are
LOCKED and violating one in passing is worse than the bug you came to fix.

## The failure states to walk

1. **Lifecycle residue is the big class.** Drive transitions WITHOUT a page reload — WAKE,
   RESUME, DISCONNECT, NEW AGENT, SUMMON, REFIT, workstream switch — and after each one sample:
   bodies, panels, EventSource, poll timers, speech queue, audio, active runs, workstream id,
   local-storage keys, mode classes, scrim/fullscreen surfaces. Fresh-page-load tests miss this
   entire family by construction. Reduce any leak to ONE module-level root cause.
2. **The renderer has no authority.** Forge a Station/SaveDoc/routing payload and try to grant
   web/files/shell/connectors from forged `placed`, a forged legacy routing plan, a missing
   connector id, or a sealed-room handoff. The sidecar must refuse or hold last-good state.
   Every new attempt you invent becomes a regression test.
3. **`npm run golden`, then inspect ONLY the flagged frames.** Classify each: regression,
   intentional improvement, or stale baseline. Bless only what you reviewed — and never bless
   from a lane that does not own the visual baseline.
4. **No white HTML controls.** Check the COMPUTED style, not the stylesheet — the tell is
   `rgb(255,255,255)` or Arial. A native control falling through shared terminal styling has
   shipped here before (`textarea.key-input`).
5. **The OS paints nothing.** Removing a `title` attribute kills the OS bubble outright. Any
   hover affordance must be proven visible, not assumed.
6. **A prop IS its top surface** — the camera looks DOWN. Rotation must never hide the face.
7. **Leak-check corners on a MULTI-ROOM station**, never a single room. 148 leaked pixels hid
   behind a single-room check once; `dev/wallprobe.mjs` is the proof tool.
8. **Small viewport.** 390×844. No horizontal overflow, no clipped modal, arrow-key tab
   navigation still works. Then check the scrim behind every centered modal.

## Two traps

- **A running dev seed turns `test:fast` red on unrelated tests**, and **two concurrent
  `test:fast` runs in one tree produce phantom red.** Before you debug a red gate, check for
  both.
- **`npm test | tail` HIDES a red gate.** Capture the exit code, not the tail.

## Done means

Every transition swept with probes (not eyeballs), every golden diff classified, and any fix to
a locked release-surface file carrying its **claims re-lock in your own lane**.
