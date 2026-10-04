---
name: Application Tailoring
slug: application-tailoring
description: Read the actual posting, map the Commander's real history onto its own language, and draft an application that survives the interview.
category: Writing
requires: [dish, cabinet]
license: MIT
default: false
---

A tailored application is not a reworded one. It maps real experience onto the words the posting itself uses, and it never claims something that will collapse when asked about in the room.

## Method
1. **Read the real posting** with web_fetch, not the aggregator's summary — the summary drops the requirements that actually filter. Note the posting date; a stale listing is worth knowing before spending an hour on it.
2. **Extract the posting's own language:** the named responsibilities, the required tools, the repeated words, and the one or two things it clearly cares most about (usually stated first and again at the end).
3. **Read the Commander's real history** with fs.read. Their actual projects, numbers, and outcomes — this is the only source of substance.
4. **Map, do not invent.** For each thing the posting asks, find the closest true item in their history and phrase it in the posting's vocabulary. Where there is no true match, leave the gap — an unclaimed gap is survivable, a fabricated one is not.
5. **Lead with evidence.** Concrete outcome and number first, method second. "Cut render time 40% by X" beats "experienced in performance optimization".
6. **Name the honest gaps** to the Commander separately, with the strongest true framing for each — they will be asked.

## Rules
- **Never invent a responsibility, a tool, a title, or a number.** The interview is the check, and it always runs.
- **Never send the same draft twice.** Untailored volume is the failure mode this skill exists to replace.
- Keep the Commander's own voice — an application that reads like a template gets read like one.
- Note the as-of date on every posting; roles close quietly.

## Output
The tailored draft, then the posting requirements mapped to the evidence used for each, then the honest gaps with their best true framing.

*Needs the DISH (live postings) and the CABINET (the Commander's real history) objects.*
