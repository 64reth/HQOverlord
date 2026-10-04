---
fingerprint: 13646d93
slug: a-mid-run-full-access-click-writes-a-per-agent-w
title: A mid-run "Full access" click writes a per-agent '*' wildcard with no readout and no revoke anywhere, and the same wildcard is read by that agent's UNATTENDED r
surface: safecell
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/safecell
fix: 226cec3c
---

# A mid-run "Full access" click writes a per-agent '*' wildcard with no readout and no revoke anywhere, and the same wildcard is read by that agent's UNATTENDED r

## Symptom

One click on "Full access" on any mid-run consent card writes '*' into a per-agent grant set that (a) never appears in the PERMISSIONS panel, whose header claims to list "every capability it may use unattended … and a REVOKE for each", (b) has no clear/revoke path anywhere in the app or the API, and (c) is read by the AUTONOMOUS broker for the same agent — so the click also blesses that agent's Telegram/cron/night-shift file and memory writes until the sidecar process exits.

## Repro

1. In a watched session, get any consent card (e.g. ask the agent to write a file) and click "Full access".
2. Open Settings → PERMISSIONS. STANDING APPROVALS shows no row for it and offers no REVOKE (only the durable cabinet:write catalog row, which was never granted).
3. With no further clicks, message the same agent over Telegram (surface 'autonomous') and ask it to write a file. The write is consented as reason 'previously granted' via the wildcard, not via any grant the Commander can see.
4. There is no in-app action that clears it; only restarting the sidecar does (the Map is process-lifetime, never persisted).

## Evidence

`sidecar/index.js:2099`

**Mechanism (read from the code):** consent.grant('full') does `if (grantsBlanket) grantsBlanket.add('*')` (permissions.js:230) and the cache tier short-circuits on it for EVERY danger class: `if (grantsBlanket && grantsBlanket.has('*')) return true;` (permissions.js:164). The store is `const grantsBlanketByAgent = new Map()` (index.js:2099) with only `blanketSetFor` (:2100-2103) reading it — `grep -n "blanketSetFor\|grantsBlanketByAgent" sidecar/index.js` shows exactly four hits: the declaration, the accessor, runOnce's broker (:10467) and the /api/autonomy/write broker (:11707). There is no deleter, no route, and no snapshot: `consent.snapshot()` returns only `{ permanent, session }` (permissions.js:236-240), so GET /api/permissions cannot report it and the panel cannot render it. runOnce at :10467 is the SAME host the messaging hub drives with surface:'autonomous' (see the comment at :10455), so the interactive click's wildcard is live for that agent's unattended runs too. The blast radius unattended is bounded — inputpolicy.js:167 blocks workspace-process and permissions.js:187's exec lockout sits above the cache tier — but cabinet:write and memory:write are cleared, which is precisely the authority the panel exists to make visible and revocable.

**Existing test coverage:** test/permissions.test.js:129-137 covers the broker semantics and asserts them as INTENDED ("blanket covers a DIFFERENT danger class without asking", "hardline still denies under full access"). Nothing tests a readout or a withdrawal of the wildcard; `grep -rln grantsBlanket test/` hits only inputpolicy/mcp.client/permissions tests, and no frontend file mentions it at all. Note: memory already records the '*' semantics as an open PRODUCT question — this finding is about the missing surface (no readout, no revoke, autonomous reuse), not the broker rule.

**Adversarial verdict (survived refutation):** Every cited line checks out and the surface gap is real. sidecar/permissions.js:230 `if (grantsBlanket) grantsBlanket.add('*')` and :164 `if (grantsBlanket && grantsBlanket.has('*')) return true;` short-circuit the cache tier for every danger class. The store is sidecar/index.js:2099 `const grantsBlanketByAgent = new Map()`; grep across sidecar/index.js returns exactly four hits — the declaration, blanketSetFor (:2100-2103), runOnce's broker (:10467) and /api/autonomy/write (:11707). There is no deleter anywhere (contrast :9854, which DOES clear grantsSession per run), no route, and no readout: consent.snapshot() (permissions.js:236-240) returns only { permanent, session }, and /api/permissions (index.js:11486) reports grantManager.snapshot() over grantsPermanent only. The autonomous reuse is real: runOnce builds ONE broker with `grantsBlanket: blanketSetFor(agentId)` at :10467 and takes `surface: surface` at :10495, so a Telegram/cron run of the same agent reads the wildcard a watched click wrote. The header promise is verbatim at frontend/app/stationui.js:4177 and the button carries no scope/duration copy (frontend/app/chat.js:1873 'Full access'). test/permissions.test.js:129-137 asserts the broker semantics as intended and never tests a readout or a withdrawal. Kept at P2 rather than raised: the mechanism itself is documented deliberate (index.js:2096-2098 — per-AGENT, in-memory, resets on restart, never persisted), the wildcard's blast radius is bounded by the exec lockout (permissions.js:187) and inputpolicy.js:164-169, and the '*'-covers-everything semantics is already logged as an open product call. The defect is only the missing readout/revoke and the interactive→unattended carry.

_Found by the `sweep/safecell` lane, 2026-07-28. Finder confidence: medium. Severity claimed P2, after refutation P2._

## Verdict

Confirmed and fixed in `226cec3c`; the stale open ledger row outlived the implementation. Full Access is now injected only for interactive runs, appears in `/api/permissions` with its agent and process-lifetime watched-session scope, and is withdrawn by the normal revoke route. `0b9270fb` adds production-composed HTTP proof that the same agent's ungranted routine remains denied while the wildcard is live, the row is visible, revoke removes real authority, and the next watched run prompts again. The panel copy also names the watched-session boundary and host hardlines instead of implying unrestricted unattended authority.
