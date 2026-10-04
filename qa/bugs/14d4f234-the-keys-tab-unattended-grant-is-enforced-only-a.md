---
fingerprint: 14d4f234
slug: the-keys-tab-unattended-grant-is-enforced-only-a
title: The KEYS-tab UNATTENDED grant is enforced only at web_request — servicekeys.runEnv() has no surface argument, so an unattended shell child receives every ENABLE
surface: providers
severity: P0
status: fixed
found: 2026-07-28
lane: sweep/providers
fix: 6afeb9ee
---

# The KEYS-tab UNATTENDED grant is enforced only at web_request — servicekeys.runEnv() has no surface argument, so an unattended shell child receives every ENABLE

## Symptom

A Commander pastes a Stripe/Printify/GitHub key in TOOLSETS → KEYS and leaves the second switch off. The row reads "watched sessions only — tick to allow scheduled & messaged runs". A cron / Night-Shift / Telegram run whose routine was granted 'workbench' can nevertheless spend that key: it is sitting in the shell child's environment as PRINTIFY_API_KEY, so one `curl -H "Authorization: Bearer $PRINTIFY_API_KEY"` acts on the Commander's paid third-party account unattended.

## Repro

Ran read-only against the real module (no repo mutation): keys = upsert(Printify, secret) → enabled, autonomous:false; upsert(Nightly) + setAutonomous('nightly', true). Then `K.resolveForRequest(keys,'PRINTIFY_API_KEY','autonomous')` → {"ok":false,"reason":"unattended","name":"Printify"} (correct), but `K.runEnv(keys, hostEnv, {})` → {"PRINTIFY_API_KEY":"pk-live-SECRET-9f3a","NIGHTLY_API_KEY":"nightly-token"} — the non-autonomous key's plaintext value is handed to the shell child. `K.runEnv.length === 3` confirms there is no surface parameter to pass. Live repro: create a routine with the terminal grant ticked, leave a KEYS entry's unattended switch OFF, let the routine fire and have it run `env | grep _API_KEY`.

## Evidence

`sidecar/servicekeys.js:224`

**Mechanism (read from the code):** `resolveForRequest(list, envVar, surface)` (servicekeys.js:172-179) correctly refuses: `if (surface !== 'interactive' && row.autonomous !== true) return { ok:false, reason:'unattended' }`. But the SHELL path goes through `runEnv(list, hostEnv, opts)` (servicekeys.js:224-235), which takes NO surface argument at all and filters on only `if (r.enabled === false) continue;` — the `autonomous` flag is never consulted. index.js:2668 wires it surface-blind: `serviceEnv: () => serviceKeysMod.runEnv(serviceKeys, process.env, { reservedEnv: SERVICEKEYS_RESERVED_ENV })`, and environment.js:379 (`const svc = serviceEnvFor();`) / :217 merge that map into every spawn, with no run context. The gap is even stated in index.js:7160-7163's own comment on the autonomy route — "this flag is read by web_request at call time, not baked into any child environment" — which is exactly why the child environment ignores it. Meanwhile servicekeys.js:136-141 promises "A scheduled, Night-Shift, or messaged run can only spend a key carrying this flag", and inputpolicy.js:66 puts 'workbench' in GRANTABLE_UNATTENDED, so shell.exec really does run on an autonomous surface (makeRunAuthority.project: `if (surface !== 'interactive' && impact === WORKSPACE_PROCESS) return workbenchGranted;`).

**Existing test coverage:** test/web-request.test.js — covers the grant ONLY on the web_request path (lines 92-103: "unattended run refuses a key that was never approved for it", "an approved key IS spendable unattended"). test/servicekeys.test.js, test/servicekeys.env.test.js, test/servicekeys.shell.e2e.test.js and test/servicekeys.http.test.js contain ZERO occurrences of 'autonomous' or 'unattended' (grepped) — the shell path has no coverage of the grant at all.

**Adversarial verdict (survived refutation):** Read every hop. sidecar/servicekeys.js:224 `function runEnv(list, hostEnv, opts)` really has no surface parameter, and its only filters are `if (r.enabled === false) continue;` (:229) and the reserved-provider-var guard (:230) — `autonomous` is never consulted, while resolveForRequest at :177 does enforce it. sidecar/index.js:2668 wires `serviceEnv: () => serviceKeysMod.runEnv(serviceKeys, process.env, {reservedEnv:…})` into a MODULE-SCOPE singleton executionEnvironment with no run context; sidecar/environment.js:217 (`return mergeServiceEnv(childEnv, serviceEnvFn())`, local backend) and :379 (`const svc = serviceEnvFor();`, docker backend) merge that map into every spawn unconditionally. I checked for an upstream guard and there is none: sidecar/tools/builtin/shell.js contains no `surface` or `serviceEnv` reference at all, and sidecar/inputpolicy.js:66 `GRANTABLE_UNATTENDED = new Set(['workbench','connectors'])` plus :120 `if (surface !== 'interactive' && impact === IMPACTS.WORKSPACE_PROCESS) return workbenchGranted;` confirm shell.exec IS reachable unattended once a routine carries the terminal grant. Not deliberate: servicekeys.js:137-140 states the opposite as a safety property ('A scheduled, Night-Shift, or messaged run can only spend a key carrying this flag'), and frontend/app/windows/connectors.js:830 renders 'watched sessions only — tick to allow scheduled & messaged runs' to the Commander. The only enforcement on the shell path is advisory prompt text (servicekeys.js:253 appends '[watched sessions only]'), which a model can ignore and an injected unattended prompt will. Test coverage claim checks out: grep for 'autonomous|unattended' in test/servicekeys*.test.js returns zero hits; test/web-request.test.js:92-103 covers only the web_request resolver.

_Found by the `sweep/providers` lane, 2026-07-28. Finder confidence: high. Severity claimed P0, after refutation P0._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
