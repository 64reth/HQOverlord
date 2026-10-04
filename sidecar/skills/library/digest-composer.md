---
name: Digest Composer
slug: digest-composer
description: Compose a recurring digest — gather the period's items, distill to signal, cite every claim.
category: Research
requires: [dish, cabinet]
license: MIT
default: false
---

Compose the periodic roundup: gather what happened over the period, distill it hard to what matters, and deliver a consistent, sourced digest. A digest is the signal, not a dump.

## Method
1. **Fix the shape.** The cadence, the audience, and the standing sections. A digest looks consistent edition to edition.
2. **Gather the period (web_search → web_fetch).** Pull the real items with their source links; read them, don't headline-skim.
3. **Distill and rank.** Keep only what clears the bar; order sections by importance. Cut the filler ruthlessly.
4. **Verify.** Confirm each headline claim against its source before it goes in. Never pad with invented or unread items.
5. **Assemble.** A tight intro, then ranked sections, each item one line with its link.

## Rules
- **Every item is sourced and real** — no fabricated or unverified entries to fill space.
- **Do not repeat prior editions** — keep past coverage in notebook.write and diff against it.
- A genuinely quiet period gets a short honest note, not inflated content.
- Draft with fs.write; the outward send rides the station's channels — draft, don't auto-broadcast without the go-ahead.

## Output
The composed digest — intro, ranked sourced sections, each item linked — ready to send.

*Needs the DISH (web) + CABINET (files) objects. Pairs with cron for scheduled composition.*
