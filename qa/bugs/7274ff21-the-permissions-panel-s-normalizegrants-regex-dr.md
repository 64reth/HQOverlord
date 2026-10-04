---
fingerprint: 7274ff21
slug: the-permissions-panel-s-normalizegrants-regex-dr
title: The Permissions panel's normalizeGrants regex drops every path: and mcp: standing grant — the ledger prints "No standing approvals yet" while the backend holds
surface: safecell
severity: P0
status: fixed
found: 2026-07-28
lane: sweep/safecell
fix: 6afeb9ee
---

# The Permissions panel's normalizeGrants regex drops every path: and mcp: standing grant — the ledger prints "No standing approvals yet" while the backend holds

## Symptom

The Commander answers "Always" to a connector consent card (or blesses a project folder). The grant is durably recorded in permissions.allow.json and is enforced on every later run. Settings → PERMISSIONS, whose header reads "STANDING APPROVALS — every capability it may use unattended, when you granted it, and a REVOKE for each (revocable any time)", does not list it. On a station whose only grants are of these kinds the panel prints the teaching empty state: "No standing approvals yet — when you answer ALWAYS to a permission prompt, it appears here." — to a user who just did exactly that. For an mcp: grant there is no other surface at all: grep of frontend/ for 'mcp:' returns zero hits, so the grant cannot be seen or withdrawn from the UI.

## Repro

From the worktree root:

node -e "const {makeGrantManager}=require('./sidecar/permgrants.js');global.Permissions=require('./frontend/app/permissions.js');const {PermissionsStore}=require('./frontend/app/permissionsstore.js');const g=new Set(['cabinet:write','mcp:Shopify-Store:execute','path:C:\\\\Users\\\\andro\\\\proj']);const gm=makeGrantManager({grantsPermanent:g,meta:{},now:()=>1});const p=Object.assign({ok:true},gm.snapshot());console.log('server:',p.grants);PermissionsStore.init({load:false,api:{load:async()=>p,grant:async()=>({}),revoke:async()=>({})}});PermissionsStore.refresh().then(()=>console.log('panel :',PermissionsStore.snapshot().grants));"

Observed:
  server: [ 'cabinet:write', 'mcp:Shopify-Store:execute', 'path:C:Usersandroproj' ]
  panel : [ 'cabinet:write' ]

Drop 'cabinet:write' from the seed set and the panel snapshot is [] → stationui.js:4911-4913 renders the "No standing approvals yet" empty state.

## Evidence

`frontend/app/permissions.js:113`

**Mechanism (read from the code):** permissionsstore.js:48 runs every server grant through `norm()` → `Permissions.normalizeGrants`, whose filter is `if (typeof k === 'string' && /^[a-z_]+:[a-z]+$/.test(k) && out.indexOf(k) < 0) out.push(k);` (permissions.js:113). Real danger keys built by the broker are `dangerKey = (tool.capability || tool.name) + ':' + tool.scope` (permissions.js:45-48). MCP tools are stamped `capability: 'mcp:' + sanitizePart(connectorId)` (mcp/translate.js:127) with `scope: readOnly ? 'read' : 'execute'` (:125), so the key is e.g. `mcp:Shopify-Store:execute` — two colons and uppercase, regex fails. Path trust records `path:<root>` (index.js:2029 `const key = 'path:' + rootReal`) — drive letters, colons, slashes, regex fails. Both are dropped before stationui.js:4908 can reach them, which is the branch whose own comment promises "a NON-curated class (blessed via a past 'always' prompt) shows its raw danger key — so nothing the agent can do unattended is ever hidden or irrevocable". That branch is dead for exactly the two key families that reach it. inputpolicy.js:147-149 justifies routing watched connector consent through the broker on the grounds that it yields "a standing grant the Commander can SEE and revoke in the Permissions panel" — that claim is false.

**Existing test coverage:** test/permpanel.test.js:59 — `eq(P.normalizeGrants(['cabinet:write','cabinet:write','BAD',42,null,'net:send']), ['cabinet:write','net:send'], ...)`. It passes vacuously: every key it feeds is already `[a-z_]+:[a-z]+`, so no real `path:*` or `mcp:*:*` key is ever exercised. `grep -n "path:\|mcp:" test/permissions-ui.test.js test/permpanel.test.js test/permissionsstore.test.js test/consent-visibility.test.js` returns nothing.

**Adversarial verdict (survived refutation):** Verified end to end. frontend/app/permissions.js:113 is exactly `/^[a-z_]+:[a-z]+$/` and frontend/app/permissionsstore.js:48 routes every server grant through it (`grants = norm(r.grants)`), so the panel's snapshot (rendered at frontend/app/stationui.js:4893 `snap.grants`) is the FILTERED list. The server does NOT filter: sidecar/index.js:11486 returns grantManager.snapshot(), and sidecar/permgrants.js:60/70 emits the whole grantsPermanent Set. Both dropped key families are real: sidecar/index.js:2029 writes `'path:' + rootReal` (drive letter + separators → regex fails) and sidecar/mcp/translate.js:127 stamps `capability: 'mcp:' + sanitizePart(connectorId)` with scope read/execute (:125), so the broker's dangerKey at sidecar/permissions.js:45-48 is `mcp:<id>:<scope>` — two colons, and sanitizePart (translate.js:35-37) preserves case and hyphens, so even a lowercase id fails. sidecar/permissions.js:216-224 ('always') is what durably writes that key. I ran the claimed repro verbatim: server `['cabinet:write','mcp:Shopify-Store:execute','path:C:Usersandroproj']` → panel `['cabinet:write']`; with cabinet:write removed the panel is [] and stationui.js:4911-4913 renders Permissions.EMPTY_APPROVALS. The design intent is documented as violated in two places: sidecar/index.js:1999-2001 ('lists + revokes through /api/permissions with no new surface') and sidecar/inputpolicy.js:148-149 ('a standing grant the Commander can SEE and revoke in the Permissions panel'). The header promise is verbatim at frontend/app/stationui.js:4177. The existing test is vacuous as claimed: test/permpanel.test.js:59 feeds only already-conforming keys, and grep for 'path:'/'mcp:' across the four permission test files returns nothing (exit 1). One correction to the title, not the finding: path: grants DO have a revoke — frontend/app/app.js:3565-3566 POSTs /api/permissions/revoke with `'path:' + r.root` from the Projects rail. mcp: has no surface at all (grep 'mcp:' over frontend/ = zero hits). Ranked P0: the trust ledger prints a false negative ('No standing approvals yet') while the backend holds live grants, and an execute-scope connector grant is unrevocable from the app.

_Found by the `sweep/safecell` lane, 2026-07-28. Finder confidence: high. Severity claimed P1, after refutation P0._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
