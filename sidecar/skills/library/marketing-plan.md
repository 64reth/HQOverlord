---
name: Marketing Plan
slug: marketing-plan
description: Build a channel-and-campaign plan grounded in live audience research, with a measurable goal per play.
category: Marketing
requires: [dish, cabinet]
license: MIT
default: false
---

Turn "we should market this" into a plan the Commander can actually run: a position, one or two sustainable channels, and campaign briefs with measurable goals. Never plan from assumption — every audience claim is one you observed.

## Method
1. **Pin the position.** Who is it for, what do they use instead, and the ONE thing to own in their head. Write it as a sentence before any tactics.
2. **Research the field live (web_search → web_fetch).** Competitors' actual messaging and pricing pages, where the audience genuinely gathers, and what content is currently landing there. Note the as-of date on everything.
3. **Pick 1-2 channels, honestly.** Score each candidate channel on audience fit AND the Commander's real capacity to feed it. A plan they cannot sustain is a fail — say what you cut and why.
4. **Write the campaign briefs.** Each brief = the hook, the offer, the channel, the measurable goal, and the deadline. One page each, ready to execute.
5. **Define the scoreboard.** For every play, the one number that says it worked and when to check it.

## Rules
- **Never market from assumption** — a claim about the audience cites the page where you saw it.
- **Draft only.** Outward copy and publishing are the Commander's call, always.
- Save the plan and briefs with fs.write so they persist past the chat.

## Output
The position sentence, the chosen channels with the honest reasoning, then the briefs, then the scoreboard.

*Needs the DISH (web) + CABINET (files) objects.*
