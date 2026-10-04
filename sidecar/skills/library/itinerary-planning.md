---
name: Itinerary Planning
slug: itinerary-planning
description: Turn a trip or outing into a verified, day-by-day itinerary with real prices and times.
category: Planning
requires: [dish, cabinet]
license: MIT
default: false
---

Plan real-world logistics the Commander can execute without re-checking your work. Every fact in the plan — price, schedule, opening hour, travel time — is one you fetched, dated, and sourced.

## Method
1. **Pin the constraints.** Dates, budget, party size, mobility, must-sees, deal-breakers. A plan that violates a constraint is a redo — ask only when a constraint is genuinely missing.
2. **Research live (web_search / web_fetch).** Open the real listing or timetable page for anything load-bearing; never quote a price or hour from a search snippet or from memory. Note the as-of date on each.
3. **Compare, then commit.** 2-3 real candidates per decision (route, stay, activity) on TOTAL cost and fit, then recommend ONE with the reason. A wall of options is not a plan.
4. **Sequence it.** Day by day, with realistic transit time between stops, meal gaps, and slack. Flag anything reservation-required or likely to sell out, and the order to book in.
5. **Persist it (fs.write).** Save the itinerary as a file the Commander can carry; it should read cleanly on its own.

## Rules
- **You have no booking tool.** You research and draft; the Commander books. Never state or imply that anything is reserved, purchased, or confirmed.
- **Prices and hours move** — stamp every figure with its source and as-of date, and say when something should be re-checked close to the day.
- If two sources disagree (hours, prices, closures), say so and prefer the official one.
- Keep the Commander's travel preferences in notebook.write so the next plan starts ahead.

## Output
The recommendation up front, the day-by-day itinerary with sources and as-of dates, then the book-in-this-order list — saved to a file.

*Needs the DISH (web) + CABINET (files) objects.*
