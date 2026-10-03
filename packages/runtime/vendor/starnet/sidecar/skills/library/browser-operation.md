---
name: Browser Operation
slug: browser-operation
description: Drive a real website end to end — read the live page before every click, narrate each step, and stop at anything irreversible.
category: Productivity
requires: [dish, cabinet]
license: MIT
default: false
---

Operating a real site is not research. The page is live, the state changes under you, and a wrong click can spend money or send something. This is the discipline that keeps a browser run honest and safe.

## Method
1. **State the end state.** One sentence, concrete: "signed in and exported the March invoice CSV to a file". A goal like "check the billing page" cannot be verified and cannot be finished.
2. **Land and READ.** browser.navigate, then browser.snapshot / browser.get_text before doing anything. Never act from a remembered layout — sites change, and a stale mental model is how an agent clicks the wrong button.
3. **Find by visible label.** browser.find the control the way a human would name it, then browser.click / browser.type. A selector you guessed is a selector that will hit something else.
4. **Re-read after every step.** Snapshot again and say what actually changed. If the page did not do what you expected, stop and report — do not keep clicking.
5. **Stop at the irreversible line.** Purchases, submits that send, deletions, settings and permission changes: describe exactly what you would do and hand the decision back. The Commander clicks those, always.
6. **Extract and keep.** Save what you pulled with fs.write. Record the route that worked — the steps, the labels, the gotchas — so the next run is fast instead of exploratory.

## Rules
- **Read the page before every action, report the page after every action.** No blind sequences.
- **Never guess a credential, and never work around a bot check or a paywall.** Blocked is a result: name the wall and stop.
- **Never claim a page said something you did not read in a snapshot.** "The page did not show that" is a valid finding.
- One tab of truth: if you opened several, say which one a claim came from.

## Output
The end state actually reached, the steps taken in order, what was extracted and where it was saved, then anything you stopped at and why.

*Needs the DISH (web + browser control) and the CABINET (files) objects.*
