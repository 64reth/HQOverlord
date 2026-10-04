---
fingerprint: 300b34ab
slug: routine-create-s-default-arm
title: routine.create's default `arm:true` bypasses the documented single resume seam and clears the durable cron E-STOP — the workshop auto-arm path at index.js:8214
surface: autonomy
severity: P2
status: fixed
found: 2026-07-28
lane: sweep/autonomy
fix: 6afeb9ee
---

# routine.create's default `arm:true` bypasses the documented single resume seam and clears the durable cron E-STOP — the workshop auto-arm path at index.js:8214

## Symptom

The Commander presses E-STOP; routines are durably stood down (the flag survives restart). Later they ask the agent, in chat or over Telegram, to "set up a daily brief". The agent calls routine.create; the Commander approves that one tool call. The emergency stop on the routines scheduler is silently cleared, cron.halt.json is rewritten to halted:false, and the tick timer restarts — every previously-halted routine resumes firing unattended. Neither the tool response, the approval card, nor any panel says the E-STOP was lifted.

## Repro

1. SKYNET_CRON_ENABLED=1, one recurring routine, scheduler armed. 2. POST /api/halt (or press ⏹ E-STOP). `curl /api/cron` → `{enabled:true, halted:true}`, log shows "cron tick DISARMED", WORKSPACES/cron.halt.json holds `{halted:true}`. 3. In COMMS ask the agent "schedule a daily standup summary at 9am" and approve the routine.create call (or run with FULL_ACCESS / approvals-off over Telegram, where it needs no click). 4. `curl /api/cron` → `{enabled:true, halted:false}`; cron.halt.json now `{halted:false}`; the log prints "cron tick armed". Every routine that was halted starts firing again, and nothing in the transcript mentions the E-STOP.

## Evidence

`sidecar/index.js:10323`

**Mechanism (read from the code):** index.js:12174-12176 documents the contract: the cron halt "persists (survives restart) and lifts only on an explicit resume (POST /api/cron/arm or an autonomy-dial re-write)". But the routine tool's injected armScheduler does the full resume unconditionally: `armScheduler: (enabled) => { const want = enabled === true; saveCronArmed(want); cronArmed = want; /* same resume semantics as POST /api/cron/arm */ if (cronHalted) { cronHalted = false; saveCronHalted(false); } if (want) armCron(); else disarmCron(); return cronArmed; }`. Its caller is a model-facing DEFAULT, not a deliberate human resume — sidecar/tools/builtin/routines.js:296 `if (!args || args.arm !== false) { try { if (typeof armScheduler === 'function') armScheduler(true); } … }`, with the schema declaring `arm: { type:'boolean', description:'Default true. When true, also enables the scheduler so routines will fire.' }`. So a tool argument the model never has to think about defeats the one "stop everything" control the product ships. The tool's own response body reports `schedulerArmed: !!schedulerState()` (routines.js:303) but has no concept of a halt, so it cannot say "and I resumed your emergency stop." Note the same call also silently re-arms when `arm:false` is absent even for a routine the Commander created while deliberately keeping scheduling off.

**Existing test coverage:** test/routine-tools.test.js:59 `A.eq(armed, true, 'routine.create arms the scheduler by default so the job will actually fire')` — asserts the arm-by-default as intended, using a fake `armScheduler: (enabled) => { armed = enabled === true; return armed; }` that has no halt concept, so it passes without ever touching cronHalted. test/lifecycle-armed.http.test.js exercises the halt only through POST /api/cron/arm (the legitimate resume), never through the tool. No test covers a tool-initiated arm against an engaged halt.

**Adversarial verdict (survived refutation):** Confirmed, and the codebase's own sibling path proves it is an oversight rather than a design choice. sidecar/index.js:10318-10326 injects `armScheduler: (enabled) => { ... if (cronHalted) { cronHalted = false; saveCronHalted(false); } if (want) armCron(); ... }`, and its caller is a model-facing DEFAULT: sidecar/tools/builtin/routines.js:296-298 `if (!args || args.arm !== false) { armScheduler(true); }`, with the schema at :245 declaring `arm` "Default true" so the model never has to supply it. Contrast sidecar/index.js:8211-8214, the workshop auto-arm, which states the rule outright — "Respect a durable E-STOP halt: record the arm INTENT but never silently restart the timer the Commander paused — the halt lifts only via the explicit resume paths (POST /api/cron/arm / autonomy-dial write)" — and implements it as `if (!cronArmed) { cronArmed = true; saveCronArmed(true); if (!cronHalted) armCron(); }`. index.js:12172-12176 makes the same promise at the halt site. There is even a documented single seam, `liftCronHalt()` at index.js:2982-2990 ("Called from every explicit resume path so halt-lift semantics can't drift"), whose only caller is index.js:11736 (the autonomy posture write) — the tool hand-rolls a third, undocumented lift. Nothing gates tool dispatch on cronHalted (the flag has only the 11 sites grep finds), so the path is reachable. The tool's own response has no halt concept — routines.js:303 reports `schedulerArmed: !!schedulerState()` where schedulerState is `() => cronArmed` (index.js:10232) — so it cannot disclose the lift. test/routine-tools.test.js:59 passes against a fake `armScheduler` with no cronHalted, so it is vacuous with respect to this. Severity held at P2 rather than raised: routine.create carries `requiresConsent: true` (routines.js:225) and the `arm` schema text does say it enables the scheduler, so a human approval is in the loop even though the card never mentions the E-STOP — the remaining call is a product decision about whether an approved create may clear a durable stop.

_Found by the `sweep/autonomy` lane, 2026-07-28. Finder confidence: medium. Severity claimed P2, after refutation P2._

## Verdict

Confirmed and fixed in `6afeb9ee`. Model-facing routine creation may preserve/set scheduler arm intent, but it cannot clear a durable E-STOP or restart the timer. Tool responses also expose the halted state instead of describing the routine as runnable. The routine-tool and lifecycle halt regressions pass.
