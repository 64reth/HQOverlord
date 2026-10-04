---
name: Exposure Reduction
slug: exposure-reduction
description: Find what is publicly exposed about the Commander, rank it by what it actually enables, and give the exact removal steps.
category: Research
requires: [dish, cabinet]
license: MIT
default: false
---

A list of everything findable about someone is anxiety, not security. The useful output is short: what an attacker or a stranger could actually DO with each item, and the specific action that removes it.

## Method
1. **Scope it with the Commander first** — which names, handles, emails, and domains are in scope. Never widen beyond what they named, and never look into anyone else.
2. **Sweep public sources only** with web_search / web_fetch: search results for their identifiers, data-broker and people-search listings, old profiles, public code and document repositories, domain and business registrations, image results.
3. **Rank by what it ENABLES, not by how exposed it feels.** A home address on a broker site and a public work email are not the same risk. Score each: what could someone do with this — account recovery, physical location, impersonation, spam?
4. **Give the removal path, specifically.** The opt-out URL, the exact form, the account setting, the support address, and the realistic turnaround. "Contact the site" is not an action.
5. **Cover the recovery surface**, which is usually the real weakness: password reuse, security questions answerable from public facts, an old email still set as a recovery address, a phone number reachable through a broker.
6. **Save the findings and the removal checklist with fs.write**, ordered so the Commander can work down it.

## Rules
- **Public sources only.** Never attempt a login, a paywall, or anything gated — and never work around a block.
- **Only the Commander, or a subject they explicitly named.** Never profile a third party, however easy it would be.
- **Every finding carries its live URL and the date seen** — an unverifiable claim causes panic and cannot be acted on.
- Rank ruthlessly and keep the list short; "nothing high-risk found" is a real and welcome result.
- Never state or restate a sensitive value (full account numbers, government IDs) in the output — name WHERE it is exposed, not what it is.

## Output
The exposures ranked by what they enable, each with its source, its removal step, and the expected turnaround — then the recovery-surface weaknesses to close first.

*Needs the DISH (public search) and the CABINET (the removal checklist) objects.*
