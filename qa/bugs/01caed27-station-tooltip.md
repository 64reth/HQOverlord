---
fingerprint: 01caed27
slug: station-tooltip
title: Station tooltip: pointerout during the 320ms show delay cannot clear the pending timer (`if (!anchor) return` runs before hide()), so a ghost card pops up besid
surface: world
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/world
fix: f4d03511
---

# Station tooltip: pointerout during the 320ms show delay cannot clear the pending timer (`if (!anchor) return` runs before hide()), so a ghost card pops up besid

## Symptom

Brush a tipped control and flick the pointer away without stopping over another tipped element — ~200ms later the phosphor tooltip appears next to the control you already left, and it stays until the pointer crosses another element boundary, a click, a scroll or a keypress.

## Repro

node repro (scratchpad/tip.js): require frontend/app/tooltip.js, call `Tooltip.init(docShim)`, fire `pointerover` on a `[title]` element, fire `pointerout` 100ms later with relatedTarget = body, then at +400ms fire `pointerover` on an untipped element — the card is shown. Live equivalent: hover any topbar/dock icon for <320ms, move the mouse off it and hold still.

## Evidence

`frontend/app/tooltip.js:136`

**Mechanism (read from the code):** `enter()` schedules `timer = setTimeout(() => { timer = null; show(el, text); }, SHOW_DELAY)` (tooltip.js:130) but `anchor` is only assigned inside `show()` (tooltip.js:104). The pointerout handler starts with `if (!anchor) return;` (tooltip.js:136), so during the whole pending window it bails BEFORE reaching `hide()` — and `hide()` is the only thing that calls `clearTimeout(timer)` (tooltip.js:95). Moving onto untipped background does not help either: `enter()` does `const el = ev.target.closest('[title],[data-tip]'); if (!el || el === anchor) return;` (tooltip.js:124-125), so an untipped target returns before any hide. `show()`'s only guard is `if (!el.isConnected) return;`. I reproduced it headless against the real module with a DOM shim: pointerover at t=0, pointerout at t=100ms, and at t=500ms `card.hidden === false`, `classList` contains `show`, `textContent` is the tip text, and `aria-describedby="station-tip"` is stamped on the element the pointer had left.

**Existing test coverage:** test/station-tooltip.test.js — covers the pure `place()` geometry, `adopt()`'s title→data-tip move, the uiZoom divide and the no-native-dialog scan. It never drives `init()`'s pointer handlers, so the delay/cancel path is uncovered.

**Adversarial verdict (survived refutation):** I read the whole of frontend/app/tooltip.js and the claim holds exactly. `anchor` is assigned in one place only — show() at tooltip.js:104 — and enter() at :128 calls hide() (which nulls anchor at :97) BEFORE arming `timer = setTimeout(() => { timer = null; show(el, text); }, SHOW_DELAY)` at :130. The pointerout listener opens with `if (!anchor) return;` at tooltip.js:136, so for the entire 320ms pending window it returns before reaching hide() at :139 — and hide() at :95 holds the only clearTimeout in the module. The escape hatch I looked for does not exist: moving onto untipped background fires pointerover → enter() → `const el = ev.target.closest('[title],[data-tip]'); if (!el || el === anchor) return;` (:124-125), which returns before any hide. show()'s only guard is `if (!el.isConnected) return;` (:103), which passes for a control that is still on screen. The card then persists until pointerdown/wheel/scroll/keydown/blur (:143-147) or the next tipped-element boundary. Deliberateness check: the header comments document the adopt/aria/zoom design and the "any commitment ends the glance" set, but nothing claims a pending tip should survive pointerout. test/station-tooltip.test.js never calls init() with a doc shim — it exercises place(), adopt(), the uiZoom divide and a source scan — so the delay/cancel path is genuinely uncovered.

_Found by the `sweep/world` lane, 2026-07-28. Finder confidence: high. Severity claimed P2, after refutation P2._

## Verdict

Confirmed and fixed in `f4d03511`; the stale open ledger row outlived the implementation. The controller now records a pending anchor before the 320ms timer and pointerout clears that pending timer through `hide()`. The real-module delayed-pointer regression proves a flicked-away control never receives `aria-describedby`, while the rested-hover path still shows and hides normally.
