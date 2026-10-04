---
fingerprint: 9c0664eb
slug: forward-version-gate-asserts-no-newer-build-is-p
title: Forward-version gate asserts "no newer build is published yet" for EVERY non-'available' phase — including check 'error' and the busy short-circuit — and the 'u
surface: release
severity: P0
status: fixed
found: 2026-07-28
lane: sweep/release
fix: 6afeb9ee
---

# Forward-version gate asserts "no newer build is published yet" for EVERY non-'available' phase — including check 'error' and the busy short-circuit — and the 'u

## Symptom

A user whose save was written by a newer StarNet is held on the blocking SAVE FROM A NEWER STARNET screen. They click UPDATE STARNET. If the update check fails (offline, GitHub unreachable, 429, draft release) or if the boot-time auto-check is still in flight, the gate prints "no newer build is published yet — check back shortly." That is a flat assertion the harness never proved — and it is the ONLY exit from a screen that has already locked them out of their station. The screen's own HTML comment (frontend/index.html:266) promises "Truthful telemetry: the message states only what the harness proved".

## Repro

Executed `frontend/app/updatecore.js` + `frontend/app/updates.js` in a node vm with a stubbed `window.__TAURI__.core.invoke`, then replayed the exact app.js:3771-3774 branch.
Case A — invoke('starnet_update_check') throws 'Could not fetch a valid release JSON from the remote':
  check() threw?           false
  returned snapshot.phase = "error"
  GATE MESSAGE SHOWN      = "no newer build is published yet - check back shortly."
Case B — a background check is still pending when the user clicks:
  busy-path snapshot.phase= "checking"
  busy-path GATE MESSAGE  = no newer build is published yet - check back shortly.
  after in-flight resolved= "available" {"version":"0.8.0"}
i.e. in case B a newer build DID exist and the gate told the user it did not.

## Evidence

`frontend/app/app.js:3773`

**Mechanism (read from the code):** `Updates.check()` (frontend/app/updates.js:139-175) NEVER rejects — it owns its own `try/catch/finally`, and on failure it sets `state.phase = 'error'` and still `return snapshot()`. It also short-circuits on a concurrent check: `if (!TAURI || !CORE || busy) return snapshot();` (line 140) returns phase `'checking'` with no work done. app.js then does `const snap = await Updates.check(true, 'future-save-gate'); if (snap && snap.phase === 'available') {...} else if (msg) msg.textContent = 'no newer build is published yet — check back shortly.';` — every non-'available' phase, including 'error' and 'checking', collapses into a confirmed-empty claim. The `catch (_) { ... 'update check failed — try again in a moment.' }` on line 3774 is DEAD CODE: it can only fire if check() throws, which it structurally cannot. The busy path is not hypothetical: `init()` calls `Updates.init(...)` at app.js:3847, whose `runLoop('startup')` fires an automatic check because `hydrateSettings` defaults `nextCheckAt` to 0 so `due()` is true on first run — and `showFutureSaveGate` is reached later in that same boot (app.js:2191 / 3905 / 3916).

**Existing test coverage:** none found. test/updatecore.test.js covers only the pure planner in updatecore.js (nextAction/recordCheckError/shouldNotify/installBlockReason); test/update-state-parity.test.js covers store-layer parity and Save.migrate(), not the gate. Grepping test/ for 'future-save-gate', 'showFutureSaveGate', 'future-msg' and 'btn-future-update' returns hits only in frontend/app/app.js, frontend/index.html and the generated website/app mirror — zero test files.

**Adversarial verdict (survived refutation):** Verified end to end. frontend/app/app.js:3771-3774 collapses every non-'available' phase into the flat assertion at :3773. frontend/app/updates.js:139-175 confirms check() cannot reject (its own try/catch/finally, ending in `return snapshot()`), so the catch at app.js:3774 is unreachable dead code; updates.js:140 `if (!TAURI || !CORE || busy) return snapshot();` returns phase 'checking' with no work done. The boot-time check is real: updatecore.js:26 defaults `autoCheck: raw.autoCheck !== false` (TRUE) and `nextCheckAt` to 0 so `due()` is true on first run, and app.js:3847 calls Updates.init un-awaited before the gate is reached at app.js:2191/3905/3916. frontend/index.html:265-266 does carry the 'Truthful telemetry: the message states only what the harness proved' promise. Only mitigation found: on the error path check(true,...) reaches updates.js:168 notify('Update check failed - '), and StationUI.toast (stationui.js:5005) appends to document.body so the toast does render over the gate — but the gate's own message element still asserts the opposite, and the busy/'checking' path returns at updates.js:140 before any notify, leaving the false claim as the only signal on a screen whose sole exit is that button.

_Found by the `sweep/release` lane, 2026-07-28. Finder confidence: high. Severity claimed P0, after refutation P0._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
