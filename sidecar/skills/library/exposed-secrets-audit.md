---
name: Exposed Secrets Audit
slug: exposed-secrets-audit
description: Hunt the ways an AI-built app leaks — keys shipped to the browser, open database rules, unprotected routes, public buckets.
category: Engineering
requires: [cabinet, workbench]
license: MIT
default: false
---

Apps assembled quickly from AI output fail security in a small, extremely predictable set of ways. This walks that list in the order that gets people hurt, and proves each finding rather than asserting it.

## Method
1. **Find what ships to the browser.** Any key in client-side code is public, no matter what it is named. Search the source and the built bundle for key-shaped strings, `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` names holding real secrets, and hardcoded tokens. A key in a client env var is exposed by definition.
2. **Check what is committed.** `.env` files in the repo, keys in the git history even if deleted since, credentials in config or seed files, service-account JSON. Note that a rotated-away key still in history is still leaked.
3. **Check the database access rules.** This is the single most common hole: row-level security disabled, a policy of `true`, an anon role able to read or write whole tables, or a public connection string. Ask what SHOULD be readable by an anonymous visitor, then verify the rules actually enforce that.
4. **Check the server routes.** Every endpoint that mutates data or returns someone else's data must verify the caller — not just that a session exists, but that THIS user owns THAT record. Missing ownership checks are the second most common hole.
5. **Check storage.** Public buckets, guessable file paths, uploads with no type or size limit.
6. **Rank by blast radius,** not by how exotic the bug is: what an anonymous stranger can reach, then any logged-in user, then an admin. For each, give the smallest concrete fix.

## Rules
- **Demonstrate the finding.** Name the file and line, or the exact request that would work. An unproven "this might be insecure" wastes the Commander's time.
- **Never test against anything the Commander does not own**, and never exfiltrate real data to prove a point — describe the request instead of harvesting the result.
- **Never print a live secret** into the output. Say where it is and what it grants, then tell them to rotate it.
- **Rotation is the first step for any leaked key** — fixing the code without rotating leaves the key live.

## Output
Findings ranked by blast radius, each with its file/line or request, what it exposes, and the smallest fix — with anything needing rotation listed first.

*Needs the CABINET (source and config) and the WORKBENCH (searching history, checking the build).*
