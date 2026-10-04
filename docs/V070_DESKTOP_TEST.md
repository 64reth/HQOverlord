# v0.7.0 desktop candidate — what to install, and what to look at

## The artifact

```
C:\Users\andro\Desktop\gen\src-tauri\target\release\bundle\nsis\StarNet_0.7.0_x64-setup.exe
```

The candidate is built from the commit tagged `v0.7.0`, which is trunk HEAD. Print the exact
identity rather than trusting a number pasted into a doc:

```bash
git rev-parse HEAD && git describe --tags --exact-match HEAD && sha256sum src-tauri/target/release/bundle/nsis/StarNet_0.7.0_x64-setup.exe
```

| | |
|---|---|
| Updater signature | `…-setup.exe.sig` — verify with `npm run release:verify-sig -- --artifact <exe> --signature <sig>` |
| Authenticode | **NOT signed.** Azure Trusted Signing only runs in CI, so SmartScreen will warn on this local build. That is expected and is *not* what ships. |

> **The artifact must be built from the tagged commit, and nothing may be committed after it.**
> `checkInstalled` in `scripts/qa/ready.mjs` compares the build's commit AND tree against the
> *current* trunk head, so one extra commit — even a docs-only one — turns the smoke BLOCKED.
> If trunk has moved since the build, rebuild before testing.

It installs **over** your existing StarNet — `identifier` is `ai.skynet.harness`, unchanged from
v0.6.8, so your crew, sessions, keys and station stay exactly where they are. `src-tauri/` is
byte-identical to v0.6.8 across all 217 commits, so nothing about where the app installs or where
its data lives has moved.

## Earning the installed-exe smoke while you're in there

This gate has been waived at v0.6.4, v0.6.5, v0.6.7 and v0.6.8. Your test is what earns it:

```bash
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'
$env:STARNET_SMOKE_EXPECTED_HEAD=(git rev-parse HEAD)
$env:STARNET_SMOKE_ARTIFACT='C:\Users\andro\Desktop\gen\src-tauri\target\release\bundle\nsis\StarNet_0.7.0_x64-setup.exe'
```

Relaunch StarNet from the Start menu with those set, then:

```bash
npm run qa:smoke:installed
```

## What to actually look at — the things the gate structurally cannot see

**Behaviour changes that will hit your existing station first:**

1. **A floor drawn `INBOX → A → B → OUTBOX` now runs BOTH agents.** It used to run only A and
   treat everything downstream as scenery. This is the single biggest change for a station you
   already built. A lone bay, or `INBOX → bay → OUTBOX`, behaves exactly as before.
2. **E-STOP mid-chain should stop every stage**, not just the one in flight. The 6-hop and $2
   chain caps are unit-proven but were **never live-tripped** — worth trying to hit one.
3. **A mutual A↔B loop is now refused** with `CHAIN_CYCLE` where it previously did nothing.

**Things nobody has ever seen work:**

4. **A restore point should appear after a shell command.** This never worked in any shipped
   build — the snapshotter was handed the wrong function and failed silently, so your restore
   list has always been empty. Run a shell command, then check for a checkpoint.
5. **The ACP editor bridge** (`npm run acp:serve`, `docs/ACP_EDITORS.md`) has **never been driven
   from a real editor** — the only proof is a spawned-bridge e2e.
6. **ABILITIES › EXTENSIONS** — create, approve, revoke and delete a hook. The authoring UI is new
   this cut.

**Art and sound you have not judged:**

7. **The easel prop.** Redrawn v6, and it is the one prop from the ugly-six pass you never gave a
   verdict on. You approved the bar and crate; the bed, lockers and tables were redrawn top-down
   after your "you're looking at it at an angle, so it makes no sense whatsoever."
8. **The wall crown on a MULTI-ROOM station.** Corner work leaked 148px on multi-room once, and a
   single room structurally cannot reproduce it.
9. **The COMMS sound board at real volume.** Level-grading was tuned by ear, and only 10 of 36
   cues were mapped before this cut.

**The one that matters most:**

10. **Your own saved station, crew and sessions open intact.** This is the only real risk left —
    217 commits of frontend and sidecar reading a save written by an older build. The installer
    layer is proven identical; the data layer is what your launch tests.

## If it's good

Tell me and I'll run `qa:guardian` + `qa:beginner` + `qa:ready` at this exact commit, then push
the branch and the tag. Nothing is pushed or published until you say so.

## If something's wrong

Say what you saw. Any fix invalidates this candidate — the bump, tag and QA all have to be redone
at the new head (`maxTrunkDrift` is 0), which is cheap but has to happen in that order.
