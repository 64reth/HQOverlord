---
fingerprint: f47a1e3a
slug: cron-store-s-armat-never-receives-the-host-defau
title: cron-store's armAt never receives the host defaultTz, so a tz-less cron routine's FIRST nextRunAt is UTC-anchored while every later advance uses local — the mar
surface: autonomy
severity: P1
status: fixed
found: 2026-07-28
lane: sweep/autonomy
fix: 226cec3c
---

# cron-store's armAt never receives the host defaultTz, so a tz-less cron routine's FIRST nextRunAt is UTC-anchored while every later advance uses local — the mar

## Symptom

Schedule a recipe from the marketplace with cadence "every morning" on a machine in, say, America/New_York. The live preview under the picker (POST /api/cron/preview) says the next fire is today 9:00 AM. The routine that gets created has nextRunAt = tomorrow 05:00 local (09:00 UTC); the ROUTINES row counts down to that, the routine fires ~20 hours later than promised and at 5 in the morning instead of 9, and only from the SECOND fire onward does it settle onto the correct local 09:00. The same one-shot skew hits every un-pause (resumeJob) and every terminal-error re-arm (markRun) of a tz-less cron routine.

## Repro

Deterministic, no server needed:
```
node -e "const cron=require('./sidecar/cron.js'),store=require('./sidecar/cron-store.js');
const now=Date.parse('2026-07-28T12:00:00Z'), s=cron.parseSchedule('0 9 * * *', now);
const j=store.createJob([],{id:'j1',name:'d',prompt:'x',schedule:s},{id:'j1',now});
console.log('persisted:', j[0].nextRunAt);
console.log('preview  :', new Date(cron.nextFireAt(s,null,now,{defaultTz:'America/New_York'})).toISOString());"
```
prints `persisted: 2026-07-29T09:00:00.000Z` vs `preview  : 2026-07-28T13:00:00.000Z`. Live: on a non-UTC host, open MARKETPLACE → any recipe → SCHEDULE IT with cadence "every morning", watch the preview say 9:00 local, then open ROUTINES and read the row's next-run countdown.

## Evidence

`sidecar/cron-store.js:100`

**Mechanism (read from the code):** cron-store's only next-fire helper drops the tz: `function armAt(schedule, lastRunIso, now) { const ms = cron.nextFireAt(schedule, lastRunIso, now); return ms != null ? iso(ms) : null; }` — no `{ defaultTz }` opts, so cron.js's `tzFor(schedule, defaultTz=null)` resolves to 'UTC' (cron.js:145-148). armAt is what stamps nextRunAt in makeJob (cron-store.js:137), updateJob's schedule re-anchor (:207), resumeJob (:220) and markRun's error re-arm (:345). The DRIVER, meanwhile, plans with the real zone: cron-driver.js:393 `cron.planTick(getJobs(), nowMs, { defaultTz: defaultTz, … })` where defaultTz = CRON_HOST_TZ (index.js:3223), which index.js:418-424 resolves from `Intl.DateTimeFormat().resolvedOptions().timeZone` — the machine's local zone, not UTC. And planTick's dueAtOf PREFERS the persisted value: cron.js:480 `if (job && job.nextRunAt) { const t = Date.parse(job.nextRunAt); return isNaN(t) ? null : t; }`. So the store's UTC-anchored stamp becomes the real first fire instant. Verified by running the actual modules: with now=2026-07-28T12:00Z and `cron.parseSchedule('0 9 * * *', now)` (tz-less, exactly what POST /api/cron produces when body.tz is absent), `store.createJob(...)` yields nextRunAt `2026-07-29T09:00:00.000Z` (= 5:00 AM EDT on the 29th), while `cron.nextFireAt(sched,null,now,{defaultTz:'America/New_York'})` — which is what handleCronPreview uses at index.js:7838 — yields `2026-07-28T13:00:00.000Z` (= 9:00 AM EDT today). planTick at the persisted instant then advances to 1785330000000 = 2026-07-29T13:00Z, i.e. the correct local 09:00, so only the first occurrence is wrong. Reachable paths that send no tz: the recipe marketplace MAKE ROUTINE (frontend/app/marketplace.js:2258-2266 posts `{name, prompt, schedule, agentId, enabled, deliver, repeat, meta}` — no tz — with CADENCE_OPTS 'morning' = `0 9 * * *`), the routine.create tool when `timezone` is omitted, and the /routine slash action. Related same-root omission: POST /api/cron/update parses a schedule patch with NO tz — index.js:7768 `patch.schedule = parseCronScheduleOr400(patch.schedule, Date.now());` — so editing a routine that WAS created with an explicit tz silently strips it (routine.manage's updateRoutine at index.js:10292 does pass patch.timezone; only the HTTP route drops it).

**Existing test coverage:** test/cron-store.test.js:52 `A.eq(jobs[0].nextRunAt, iso(Date.parse('2026-06-19T09:00:00Z')), 'cron arms at its next matching time')` — it asserts the UTC-anchored value and never injects a defaultTz, so it encodes the buggy behaviour rather than catching it. test/cron.api.test.js:97 only asserts `nextRunAt` is truthy for a tz-less cron create. test/cron.dst.test.js:113-124 proves cron.nextFireAt honours an injected defaultTz, but nothing routes that through cron-store.

**Adversarial verdict (survived refutation):** Confirmed by reading the code and by running the repro in this worktree. sidecar/cron-store.js:99-102 `armAt(schedule,lastRunIso,now)` calls `cron.nextFireAt(schedule,lastRunIso,now)` with NO opts, so sidecar/cron.js:145-148 `tzFor` resolves to 'UTC'; armAt is the stamp for makeJob (cron-store.js:137), updateJob's schedule re-anchor (:207), resumeJob (:220) and markRun's error re-arm (:345). The driver disagrees: sidecar/cron-driver.js:393 passes `{ defaultTz }` = CRON_HOST_TZ, which sidecar/index.js:418-424 resolves from `Intl.DateTimeFormat().resolvedOptions().timeZone`; and sidecar/cron.js:479-482 `dueAtOf` PREFERS the persisted `job.nextRunAt`, so the UTC stamp becomes the real first fire. Live run: `store.createJob` for `0 9 * * *` at now=2026-07-28T12:00Z yields nextRunAt `2026-07-29T09:00:00.000Z` (05:00 EDT next day) while `cron.nextFireAt(sched,null,now,{defaultTz:'America/New_York'})` — exactly what handleCronPreview uses at index.js:7838 — yields `2026-07-28T13:00:00.000Z` (09:00 EDT today); planTick then advances to `2026-07-29T13:00:00.000Z`, i.e. only the FIRST occurrence is skewed. The tz-less path is genuinely reachable: frontend/app/marketplace.js:2260-2264 posts `{name,prompt,schedule,agentId,enabled,deliver,repeat,meta}` with no tz (CADENCE_OPTS 'morning' = '0 9 * * *' at marketplace.js:71) and its preview at marketplace.js:2224 also posts `{schedule}` with no tz, so the preview reads local while the create writes UTC. sidecar/index.js:7718 forwards `body.tz` (undefined) into parseCronScheduleOr400, and nothing downstream repairs it — cron-driver has no re-anchor path. The ROUTINES window itself is safe (frontend/app/windows/routines.js:348-354 sends the browser tz), so the marketplace/tool-omitted paths are the exposed ones. Secondary claim also holds: sidecar/index.js:7765 `parseCronScheduleOr400(patch.schedule, Date.now())` drops tz on POST /api/cron/update while the tool path at index.js:10290 passes patch.timezone. test/cron-store.test.js:52 asserts the UTC value with no defaultTz injected, so it encodes the behaviour rather than catching it.

_Found by the `sweep/autonomy` lane, 2026-07-28. Finder confidence: high. Severity claimed P1, after refutation P1._

## Verdict

Confirmed and fixed in `226cec3c`. The sidecar now injects its resolved host timezone through every store arm/re-arm path, while an explicit routine timezone still wins. The live API preview/create comparison in America/New_York produced the identical first fire (`2026-08-02T13:00:00.000Z`), and the cron-store regression suite covers create, update, resume, and terminal-error re-arm behavior.
