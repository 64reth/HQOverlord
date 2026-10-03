---
name: Negotiation Case
slug: negotiation-case
description: Build a checkable evidence case for a better price, refund, or rate — then draft the opening, the rebuttals, and the walk-away.
category: Communication
requires: [cabinet, dish]
license: MIT
default: false
---

A negotiation without a floor is a request. The work is done before the first message: the objective, the evidence, the counterpart's incentive, and the point at which you walk.

## Method
1. **Set the objective and the walk-away.** A target number and the point below which the Commander stops. Write both down before drafting a single sentence.
2. **Assemble checkable evidence.** The contract or invoice via fs.read; the outage, defect, or service-failure record; how long they have been a customer; what they have already paid. Every claim must be verifiable by the other side — an unverifiable claim invites a flat no.
3. **Anchor on a sourced number.** Find the real going rate or a competitor's live price with web_search / web_fetch and cite it. A sourced anchor moves a counterpart; a confident guess does not.
4. **Name their incentive.** What makes yes cheap for the person actually reading it: retention, churn risk, avoiding an escalation, a concession small enough to approve without a manager. Aim at the concession they are allowed to grant.
5. **Draft the full sequence:** the opening ask (specific, firm, not hostile), the two most likely rebuttals with the answer to each, and the concession ladder in the order you would give ground.
6. **Log the outcome** — what was asked, what was offered, what actually moved them — so the next one opens smarter.

## Rules
- **The Commander sends every message.** Draft and hand over; never negotiate on their behalf, and never promise a result.
- **Never threaten anything the Commander would not do**, and never misrepresent a fact to gain leverage — one caught exaggeration ends the case.
- **Specific beats aggressive.** "Match the $Y I was quoted here" outperforms "this is unacceptable".
- If the evidence does not support the ask, say so — a weak case is worth knowing before opening.

## Output
The case with its evidence, the drafted opening message, the rebuttal answers, the concession ladder, and the walk-away line.

*Needs the CABINET (invoices, contracts) and the DISH (live comparable prices) objects.*
