---
name: Accessibility Audit
slug: accessibility-audit
description: Check a live page against the barriers that actually lock people out — keyboard, contrast, labels, focus — each with the fix.
category: Engineering
requires: [dish, cabinet]
license: MIT
default: false
---

Accessibility work goes wrong when it becomes a list of automated warnings nobody acts on. The useful version checks the small number of failures that genuinely prevent someone from using the page, and proves each one on the live page.

## Method
1. **Walk the page with the keyboard only.** Tab through every interactive element in order. Anything reachable by mouse but not by keyboard is a hard blocker, as is a focus trap you cannot escape, or a tab order that jumps around the page.
2. **Check that focus is VISIBLE.** A removed focus outline with nothing in its place makes keyboard use impossible even when the tab order is correct.
3. **Check names on controls.** Every button, link, input, and icon-only control needs an accessible name. Read the page's structure and find controls whose name is empty, or is "button", or is a filename.
4. **Check contrast on real rendered colours** — body text, muted/secondary text, placeholder text, text on images, and disabled states, which are the ones that usually fail.
5. **Check structure:** one main heading, headings that descend without skipping, form inputs tied to labels, images with alt text that says what the image MEANS (and empty alt for decoration).
6. **Check motion and state:** anything that animates or auto-plays, and whether errors are announced rather than only shown in red.
7. **Rank by who is locked out.** A keyboard trap outranks a heading-order warning by a wide margin.

## Rules
- **Test the live rendered page**, not the source — computed colours and injected markup are what users actually meet.
- **Every finding names the element and gives the concrete fix**, not a WCAG number on its own.
- **Never claim compliance.** Automated and manual checks find barriers; they do not certify a standard. Say what was checked and what was not.
- Real assistive-technology testing by a human is the finish line — say so when the stakes warrant it.

## Output
Blockers first (keyboard, focus, unnamed controls), then serious issues, then polish — each with the element, what it breaks for whom, and the fix. Plus what you could not check.

*Needs the DISH (the live page) and the CABINET (the source to fix).*
