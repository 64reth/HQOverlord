/* sidecar/cron.js — the PURE cron-math core of the scheduled-routines subsystem (CRON Commit 1).

   The determinism keystone of the whole cron feature: every function here is a pure transform
   over (input, now) — `now` is always a PARAMETER (injected ms epoch), never the wall clock. There
   is NO Date.now / Math.random / setTimeout / fs in this file, so it passes lint-determinism.js and
   is headless-testable exactly like loop.js / permissions.js. The ambient half (the setInterval
   timer, the real now-source, id minting, persistence) lives only in sidecar/index.js — see
   docs/CRON_INTEGRATION_PLAN.md §3.1.

   Scope (locked 2026-06-18): `interval`, `once`, and a deterministic 5-field cron subset:
   numeric fields with *, lists, ranges, and steps. It is intentionally not a full croniter port
   (no named months/days, seconds/year fields).

   --- TIMEZONE / DST (G4.1, 2026-06-23) ---------------------------------------------------------
   A `cron` schedule may carry an optional IANA `tz` (e.g. "America/New_York"). When present, cron
   fields are matched on LOCAL WALL-CLOCK time in that zone, so `0 9 * * *` fires at 09:00 LOCAL and
   shifts correctly across DST (09:00 EST = 14:00Z in winter, 09:00 EDT = 13:00Z in summer). The
   matcher stays PURE: `Intl.DateTimeFormat(en-US, { timeZone, ... })` is a pure function of the
   candidate ms + the tz string, so there is NO Date.now/new Date()/Math.random here and this file
   still passes lint-determinism.js. The host's real tz is NOT read from the ambient clock inside
   this module — it is INJECTED as `opts.defaultTz` by the host (sidecar/index.js), so a tz-less
   schedule resolves under a caller-supplied default while the module stays deterministic.

   Default tz = UTC: a tz-less schedule (or tz:'UTC') matches on UTC exactly as before this change —
   no signature break, no behavior change for existing callers/tests. An INVALID IANA tz string is
   REJECTED at parse time (parseSchedule -> null) so a typo can NEVER silently fall back to UTC and
   re-introduce a lie about when a routine fires.

   The two hard DST cases have an EXPLICIT, TESTED policy (test/cron.dst.test.js):
     · NONEXISTENT local time (spring-forward skipped hour — e.g. 02:30 on a US spring-forward day,
       when the local clock jumps 01:59 -> 03:00): fires EXACTLY ONCE at the POST-TRANSITION instant
       (the requested wall time shifted forward across the gap; 02:30 -> 03:30 local). Never silently
       skipped, never double-fired. Implemented by the offset-drift repair branch in nextCronFireAt.
     · AMBIGUOUS local time (fall-back doubled hour — e.g. 01:30 on a US fall-back day, which occurs
       twice): fires EXACTLY ONCE at the FIRST occurrence (the earlier UTC instant). The minute-by-
       minute forward scan naturally returns the first matching instant; advancing strictly after it
       skips the second occurrence, so it never double-fires.
   -----------------------------------------------------------------------------------------------

   --- ONE-SHOT FIRE-CLAIM / at-most-once-within-window (G4.5, 2026-06-23) -----------------------
   A recurring job is protected from a crash-restart double-fire by ADVANCE-BEFORE-RUN: planTick
   emits the advanced nextRunAt and the host persists it BEFORE the run launches, so a restart sees
   the advanced time and does not re-fire. A one-shot (kind:'once') has no "next" fire to advance, so
   it needs the analog: a FIRE-CLAIM. The host stamps a one-shot's `fireClaim` (= the fire-instant ms)
   at fire time and persists it BEFORE launching (cron-store.claimOnceFire). planTick then enforces an
   AT-MOST-ONCE-WITHIN-WINDOW policy on a one-shot:
     · FRESH claim (claim age = now - fireClaim, 0 <= age < maxRunMs): the run is in flight → NOT due,
       suppress re-fire. A crash-restart INSIDE the run window therefore does NOT re-fire the one-shot.
     · NS-0 LEASE HEARTBEAT (2026-07-07): the wall-clock maxRunMs claim ceiling is a FALLBACK; the primary
       liveness signal is `heartbeatAt`, renewed by the driver on every run-progress event. A one-shot whose
       heartbeat is fresher than heartbeatStaleMs (default maxRunMs*2) is provably still running and is NOT
       re-fired NO MATTER how old the claim is — so a legitimately-long research run that outlives maxRunMs
       fires EXACTLY ONCE. A STALE heartbeat (the holder crashed — beats stopped) falls through to the claim
       reclaim, so a genuinely-dead run is still recovered. markRun clears heartbeatAt alongside fireClaim.
     · ZOMBIE claim (age >= maxRunMs AND heartbeat stale/absent): the holder crashed and never settled within
       the lease ceiling → the claim is reclaimed and the one-shot re-fires (it never stays wedged forever).
     · SETTLED (lastRunAt set): permanently ineligible (the pre-existing guard), independent of claim.
   markRun CLEARS fireClaim on EVERY settlement (success / terminal failure / transient failure), so
   the not-due guard suppresses re-fire ONLY while the run is genuinely in flight. A TRANSIENT failure
   clears the claim and re-arms via the normal backoff nextRunAt — it is NOT suppressed by a stale
   claim. `maxRunMs` is injected via opts (the host's lease ceiling); default 8min if absent.
   -----------------------------------------------------------------------------------------------

   Surface (all `now`/`tz` are PARAMETERS — never ambient):
     parseSchedule(str, now, opts?)              -> schedule | null   // opts.tz = optional IANA tz for cron
     nextFireAt(schedule, lastRunIso, now, opts?)-> int ms | null     // opts.defaultTz applied to tz-less cron
     planTick(jobs, now, opts?)                  -> { fire[], skipped[], next[] }   // opts.defaultTz
     dueJobs(jobs, now, opts?)                   -> { fire[], advanced[] }          // opts.defaultTz
     computeGraceMs(schedule, anchor, opts?)     -> int ms

   A `schedule` is one of:
     { kind:'interval', minutes:int, display:str }
     { kind:'once', runAt:int(ms epoch), display:str }
     { kind:'cron', expr:str, fields:{...}, dayOfMonthWildcard:bool, dayOfWeekWildcard:bool,
       tz?:str(IANA), display:str } */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).cron = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const CRON_SEARCH_LIMIT_MS = 5 * 366 * DAY;       // enough to cover leap-day schedules
  const UNIT_MS = { s: 1000, m: MIN, h: HOUR, d: DAY };

  // ---- timezone support (pure: Intl.DateTimeFormat is deterministic given the ms epoch + tz) ----

  // true iff `tz` is a usable IANA zone (UTC, or any zone Intl accepts). A typo throws -> false, so
  // an invalid tz is rejected at parse time rather than silently treated as UTC.
  function isValidTz(tz) {
    if (tz == null || tz === '') return true;          // absent tz means "UTC default" — valid
    if (typeof tz !== 'string') return false;
    if (tz === 'UTC') return true;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
    catch (_) { return false; }
  }

  // a tiny per-(tz) formatter cache so a long minute-by-minute scan doesn't rebuild the formatter each step.
  const _fmtCache = Object.create(null);
  function localFmt(tz) {
    const key = tz || 'UTC';
    let f = _fmtCache[key];
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: key, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      _fmtCache[key] = f;
    }
    return f;
  }

  // local wall-clock fields of an instant in a tz: { year, month(1-12), day, hour(0-23), minute, minOfDay }.
  // Pure in (ms, tz). `hour:'2-digit', hour12:false` yields "24" at local midnight in some engines — fold to 0.
  function localFieldsOf(ms, tz) {
    const parts = localFmt(tz).formatToParts(ms);
    const g = {};
    for (const p of parts) if (p.type !== 'literal') g[p.type] = p.value;
    let hour = parseInt(g.hour, 10); if (hour === 24) hour = 0;
    const minute = parseInt(g.minute, 10);
    return {
      year: parseInt(g.year, 10),
      month: parseInt(g.month, 10),
      day: parseInt(g.day, 10),
      hour: hour,
      minute: minute,
      minOfDay: hour * 60 + minute
    };
  }

  // day-of-week (0=Sun..6=Sat) of an instant in a tz. Pure in (ms, tz).
  const _dowCache = Object.create(null);
  function localDow(ms, tz) {
    const key = tz || 'UTC';
    let f = _dowCache[key];
    if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: key, weekday: 'short' }); _dowCache[key] = f; }
    const wd = f.format(ms);
    const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
    return idx == null ? new Date(ms).getUTCDay() : idx;
  }

  // resolve the effective tz for a cron schedule: its own tz, else the injected default, else UTC.
  function tzFor(schedule, defaultTz) {
    const t = schedule && schedule.tz != null ? schedule.tz : defaultTz;
    return t == null || t === '' ? 'UTC' : t;
  }

  // normalize a unit token to one of s/m/h/d, or null if unrecognised.
  function normalizeUnit(u) {
    u = String(u || '').toLowerCase();
    if (/^(s|sec|secs|second|seconds)$/.test(u)) return 's';
    if (/^(m|min|mins|minute|minutes)$/.test(u)) return 'm';
    if (/^(h|hr|hrs|hour|hours)$/.test(u)) return 'h';
    if (/^(d|day|days)$/.test(u)) return 'd';
    return null;
  }

  // ms (with an argument — the lint bans only the zero-arg new Date()) -> ISO string. Deterministic in ms.
  function iso(ms) { return new Date(ms).toISOString(); }

  // a compact human label for an interval/duration in ms: prefers whole days/hours, else minutes.
  function humanDuration(ms) {
    const min = Math.round(ms / MIN);
    if (min > 0 && min % 1440 === 0) return (min / 1440) + 'd';
    if (min > 0 && min % 60 === 0) return (min / 60) + 'h';
    return min + 'm';
  }

  // The interval period in ms (0 for non-interval schedules).
  function periodMs(schedule) {
    return schedule && schedule.kind === 'interval' ? schedule.minutes * MIN : 0;
  }

  function parseUInt(s) {
    return /^\d+$/.test(String(s || '')) ? parseInt(s, 10) : NaN;
  }

  function uniqueSorted(values) {
    const seen = Object.create(null), out = [];
    for (const v of values) {
      const k = String(v);
      if (!seen[k]) { seen[k] = true; out.push(v); }
    }
    return out.sort((a, b) => a - b);
  }

  function isFullRange(values, min, max) {
    if (!values || values.length !== (max - min + 1)) return false;
    for (let v = min; v <= max; v++) if (values.indexOf(v) < 0) return false;
    return true;
  }

  function parseCronField(raw, min, max, opts) {
    opts = opts || {};
    const normMin = opts.normMin != null ? opts.normMin : min;
    const normMax = opts.normMax != null ? opts.normMax : max;
    const sevenAsSunday = !!opts.sevenAsSunday;
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    const values = [];
    const parts = text.split(',');
    for (const part of parts) {
      if (!part) return null;
      const stepBits = part.split('/');
      if (stepBits.length > 2) return null;
      const base = stepBits[0];
      const step = stepBits.length === 2 ? parseUInt(stepBits[1]) : 1;
      if (!step || step <= 0 || isNaN(step)) return null;

      let start, end;
      if (base === '*') {
        start = min; end = max;
      } else if (base.indexOf('-') >= 0) {
        const rangeBits = base.split('-');
        if (rangeBits.length !== 2) return null;
        start = parseUInt(rangeBits[0]); end = parseUInt(rangeBits[1]);
      } else {
        start = parseUInt(base);
        end = stepBits.length === 2 ? max : start;  // "5/10" means 5-max/10
      }
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) return null;
      for (let v = start; v <= end; v += step) values.push(sevenAsSunday && v === 7 ? 0 : v);
    }
    const sorted = uniqueSorted(values);
    if (!sorted.length) return null;
    return { values: sorted, wildcard: isFullRange(sorted, normMin, normMax) };
  }

  function parseCronExpression(raw) {
    const expr = String(raw == null ? '' : raw).trim().split(/\s+/).join(' ');
    const parts = expr ? expr.split(/\s+/) : [];
    if (parts.length !== 5) return null;
    const minute = parseCronField(parts[0], 0, 59);
    const hour = parseCronField(parts[1], 0, 23);
    const dayOfMonth = parseCronField(parts[2], 1, 31);
    const month = parseCronField(parts[3], 1, 12);
    const dayOfWeek = parseCronField(parts[4], 0, 7, { sevenAsSunday: true, normMin: 0, normMax: 6 });
    if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
    return {
      kind: 'cron',
      expr: expr,
      fields: {
        minute: minute.values,
        hour: hour.values,
        dayOfMonth: dayOfMonth.values,
        month: month.values,
        dayOfWeek: dayOfWeek.values
      },
      dayOfMonthWildcard: dayOfMonth.wildcard,
      dayOfWeekWildcard: dayOfWeek.wildcard,
      display: 'cron ' + expr
    };
  }

  function cronSpec(schedule) {
    if (!schedule || schedule.kind !== 'cron') return null;
    const f = schedule.fields;
    if (f && Array.isArray(f.minute) && Array.isArray(f.hour) && Array.isArray(f.dayOfMonth) &&
      Array.isArray(f.month) && Array.isArray(f.dayOfWeek)) return schedule;
    return parseCronExpression(schedule.expr || '');
  }

  function has(values, value) { return values.indexOf(value) >= 0; }

  /* cronDateOk — can any minute of the LOCAL calendar date holding `ms` match the spec's date fields?
     The single source of the Vixie/croniter day semantics: if both DOM and DOW are restricted, either may
     match; if one is wildcard/full-range, the restricted field controls through ordinary AND matching.
     Used by the matcher below AND by the scan's day-skip (a date this rejects has no matchable minute). */
  function cronDateOk(spec, ms, tz, lf) {
    const f = spec.fields;
    if (!has(f.month, lf.month)) return false;
    const dom = has(f.dayOfMonth, lf.day);
    const dow = has(f.dayOfWeek, localDow(ms, tz));
    if (!spec.dayOfMonthWildcard && !spec.dayOfWeekWildcard) return dom || dow;
    return dom && dow;
  }

  // does the cron spec match the LOCAL wall-clock of `ms` in `tz`? (tz='UTC' reproduces the old UTC match.)
  function cronMatchesSpec(spec, ms, tz) {
    const f = spec.fields;
    const lf = localFieldsOf(ms, tz);
    if (!has(f.minute, lf.minute)) return false;
    if (!has(f.hour, lf.hour)) return false;
    return cronDateOk(spec, ms, tz, lf);
  }

  /* cronDateFeasible — can the spec's date fields EVER name a real calendar date? false only for a
     well-formed but IMPOSSIBLE dom/month combination (e.g. "0 0 30 2 *" — Feb 30, "0 0 31 4 *" — Apr 31).
     Such an expression parses cleanly, matches nothing, and before this check the rejection was produced
     by grinding the ENTIRE bounded search (5y × 366d × 1440min of formatToParts) synchronously — a
     multi-second event-loop stall reachable straight from POST /api/cron[/preview]. Feb 29 stays feasible
     (leap years exist; whether one falls inside the bounded window is the scan's business, not this check's).
     Only the dom-controls case can be infeasible: with both DOM and DOW restricted the day rule is OR, so
     the DOW leg alone can always satisfy some date. */
  const MONTH_MAX_DAY = { 1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
  function cronDateFeasible(spec) {
    if (spec.dayOfMonthWildcard || !spec.dayOfWeekWildcard) return true;
    const f = spec.fields;
    for (const mo of f.month) {
      const mx = MONTH_MAX_DAY[mo] || 31;
      for (const d of f.dayOfMonth) if (d <= mx) return true;
    }
    return false;
  }

  // does a cron spec match a SYNTHETIC local time (the skipped wall-time inside a spring-forward gap)?
  // Reuses the local calendar date of the post-transition instant `ms` (the gap never crosses a date in
  // the IANA zones we support) but substitutes the skipped hour/minute. dow uses the post-transition dow,
  // which is identical across the gap (the gap is sub-day). Pure: no clock read.
  function cronMatchesLocalHM(spec, ms, tz, hour, minute) {
    const f = spec.fields;
    const lf = localFieldsOf(ms, tz);
    if (!has(f.minute, minute)) return false;
    if (!has(f.hour, hour)) return false;
    if (!has(f.month, lf.month)) return false;
    const dom = has(f.dayOfMonth, lf.day);
    const dow = has(f.dayOfWeek, localDow(ms, tz));
    if (!spec.dayOfMonthWildcard && !spec.dayOfWeekWildcard) return dom || dow;
    return dom && dow;
  }

  /* nextCronFireAt(schedule, anchorMs, tz) — the first instant strictly after the anchor whose LOCAL
     wall-clock (in `tz`) matches the cron fields, scanning minute-by-minute. Two DST subtleties handled
     by an OFFSET-DRIFT detector that watches the local minute-of-day move between adjacent UTC minutes:
       · NONEXISTENT (spring-forward gap): the local clock jumps FORWARD (e.g. 01:59 -> 03:00), so the
         requested wall minute (02:30) never appears in the scan and would be skipped forever. POLICY:
         fire EXACTLY ONCE at the POST-TRANSITION EQUIVALENT — the requested time shifted forward across
         the gap (02:30 -> 03:30). We compute that equivalent and fire when the (real) local clock reaches
         it, so a skipped local time is neither dropped nor doubled.
       · AMBIGUOUS (fall-back repeat): the local clock jumps BACKWARD (e.g. 01:59 EDT -> 01:00 EST), so a
         matching wall minute (01:30) occurs TWICE. POLICY: fire EXACTLY ONCE at the FIRST occurrence. The
         forward scan reaches the first occurrence first; the SECOND occurrence is in a repeated band, which
         we SUPPRESS until the local clock climbs back past the fall-back point (leaving the ambiguous hour).
     tz defaults to UTC, reproducing the original UTC matcher byte-for-byte (no transitions -> no drift). */
  function nextCronFireAt(schedule, anchorMs, tz) {
    const spec = cronSpec(schedule);
    if (!spec) return null;
    if (!cronDateFeasible(spec)) return null;   // an impossible dom/month combo answers in O(fields), not a 2.6M-step scan
    const zone = tz == null || tz === '' ? 'UTC' : tz;
    let t = Math.floor((anchorMs || 0) / MIN) * MIN + MIN;  // strictly after the anchor, minute-granular
    const stop = t + CRON_SEARCH_LIMIT_MS;
    let prev = localFieldsOf(t - MIN, zone);
    // when a fall-back repeats an hour, suppress matches whose local minute-of-day is <= this watermark
    // on the day the repeat began, until the clock climbs past it (we've exited the doubled window).
    let repeatBand = -1, repeatDay = -1;
    for (; t <= stop; t += MIN) {
      const lf = localFieldsOf(t, zone);
      if (zone !== 'UTC') {
        // A spring-forward gap can straddle LOCAL MIDNIGHT (Havana/Santiago: transition at 00:00, so the
        // clock reads 23:59 -> 01:00 next day). On the raw minute-of-day axis that is 1439 -> 60 and the
        // plain `>` test saw NO gap — a 00:30 routine silently skipped its fire that day, violating this
        // function's own never-skipped policy. Compare on a rollover-adjusted axis instead: when the day
        // changed, the previous minute sits at (minOfDay - 1440) relative to the new day, so the ordinary
        // midnight step (1439 -> 0) reads as -1 -> 0 (no gap) while Havana reads -1 -> 60 (a 60min gap).
        const dayChanged = lf.day !== prev.day || lf.month !== prev.month || lf.year !== prev.year;
        const effPrev = (dayChanged && lf.minOfDay < prev.minOfDay) ? prev.minOfDay - 1440 : prev.minOfDay;
        if (lf.minOfDay > effPrev + 1) {
          // SPRING-FORWARD gap (effPrev+1 .. lf.minOfDay-1 are skipped). Fire any matching skipped
          // wall time at its post-transition equivalent (skipped minute + gap size = this side of the gap).
          const gap = lf.minOfDay - effPrev - 1;
          for (let m = effPrev + 1; m < lf.minOfDay; m++) {
            const hm = ((m % 1440) + 1440) % 1440;   // m < 0 = a pre-midnight minute of the PREVIOUS day
            if (cronMatchesLocalHM(spec, m < 0 ? t - MIN : t, zone, Math.floor(hm / 60) % 24, hm % 60)) {
              return t + (m + gap - lf.minOfDay) * MIN;       // the instant whose local clock reads m+gap
            }
          }
        } else if (lf.minOfDay < prev.minOfDay && lf.day === prev.day) {
          // FALL-BACK repeat began: the hour [lf.minOfDay .. prev.minOfDay] is being replayed this day.
          repeatBand = prev.minOfDay; repeatDay = lf.year * 10000 + lf.month * 100 + lf.day;
        }
        if (repeatBand >= 0) {
          const curDay = lf.year * 10000 + lf.month * 100 + lf.day;
          if (curDay !== repeatDay || lf.minOfDay > repeatBand) { repeatBand = -1; repeatDay = -1; }
        }
      }
      const inRepeat = repeatBand >= 0 && lf.minOfDay <= repeatBand;
      if (!inRepeat && cronMatchesSpec(spec, t, zone)) return t;
      /* DAY-SKIP (perf, bug-sweep 2026-08-28): when this local DATE can never match (wrong month/dom/dow),
         leap toward local midnight instead of grinding ~1440 formatToParts calls through it — a sparse
         schedule ("0 0 29 2 *", monthly grace scans) cost seconds of synchronous event-loop stall. The
         jump UNDERSHOOTS midnight by >= 61 minutes so the day boundary — where the midnight-straddling
         spring-forward gaps (Havana/Santiago) live — is still crossed one minute at a time, exactly as the
         adjacent-minute drift detector above requires. A mid-skip DST transition is invisible by
         construction: `prev` is re-derived at (landing - 1min), so the detector always compares ADJACENT
         minutes, and no skipped minute could have matched (that is the skip's precondition), so no gap-fire
         or repeat-suppression decision is ever lost. Never jump while a fall-back repeat band is armed.
         The worst DST shift is +-1h, so landing stays strictly inside the same local day (1440-61+60 < 1440). */
      if (repeatBand < 0 && !cronDateOk(spec, t, zone, lf)) {
        const skip = 1440 - lf.minOfDay - 61;
        if (skip > 1) {
          t += (skip - 1) * MIN;                 // the for-step adds the final minute of the jump
          prev = localFieldsOf(t, zone);         // adjacent-minute baseline at the landing point
          continue;
        }
      }
      prev = lf;
    }
    return null;
  }

  /* isFireable — can this schedule ever PRODUCE a fire time? Kind alone is not enough: a migrated/hand-edited
     record like { kind:'interval', minutes:NaN } or { kind:'cron', expr:'garbage' } passed the old kind-only
     check, so the driver's unfireable-marking (step 1c) never saw it and the routine sat "scheduled" forever —
     and a NaN period flowed into iso(NaN) and threw the WHOLE tick out for every routine in the store. */
  function isFireable(schedule) {
    if (!schedule) return false;
    if (schedule.kind === 'once') {
      const t = typeof schedule.runAt === 'number' ? schedule.runAt : Date.parse(schedule.runAt);
      return isFinite(t);
    }
    if (schedule.kind === 'interval') { const p = periodMs(schedule); return isFinite(p) && p > 0; }
    if (schedule.kind === 'cron') {
      const spec = cronSpec(schedule);
      return spec != null && cronDateFeasible(spec);   // an impossible dom/month combo can never fire — visible, not idle-forever
    }
    return false;
  }

  function isRecurring(schedule) {
    return !!(schedule && (schedule.kind === 'interval' || schedule.kind === 'cron'));
  }

  function nextRecurringAt(schedule, now, defaultTz) {
    if (!schedule) return null;
    if (schedule.kind === 'interval') return now + periodMs(schedule);
    if (schedule.kind === 'cron') return nextCronFireAt(schedule, now, tzFor(schedule, defaultTz));
    return null;
  }

  /* parseSchedule(str, now, opts?) — turn a human string into a tagged schedule, or null if unparseable.
     `now` is used ONLY to resolve a relative duration ("in 2h") into an absolute runAt; it is a
     parameter so the result is reproducible. Match order: interval -> once-duration -> ISO -> cron.
     opts.tz (optional IANA string) is attached to a CRON schedule so it matches on local wall-clock;
     an INVALID tz returns null (never a silent UTC fallback). tz is ignored for interval/once (which
     are absolute-ms by construction and have no wall-clock ambiguity). */
  function parseSchedule(str, now, opts) {
    const raw = String(str == null ? '' : str).trim();
    if (!raw) return null;
    now = now || 0;
    opts = opts || {};
    const tz = opts.tz != null && opts.tz !== '' ? String(opts.tz) : null;
    if (tz != null && !isValidTz(tz)) return null;          // a typo'd tz is rejected, never silently UTC
    const lower = raw.toLowerCase();

    // 1. INTERVAL — "every <N> <unit>" (N optional => 1, e.g. "every hour"). Minute-granular: m/h/d only.
    let m = lower.match(/^every\s+(?:(\d+)\s*)?([a-z]+)$/);
    if (m) {
      const n = m[1] ? parseInt(m[1], 10) : 1;
      const u = normalizeUnit(m[2]);
      if (!u || u === 's' || n <= 0) return null;           // sub-minute intervals are meaningless vs a 60s tick
      const minutes = n * (u === 'm' ? 1 : u === 'h' ? 60 : 1440);
      if (minutes < 1) return null;
      return { kind: 'interval', minutes: minutes, display: 'every ' + humanDuration(minutes * MIN) };
    }

    // 2. ONCE (relative) — "in <N> <unit>" or a bare "<N><unit>". Seconds allowed for a one-shot.
    m = lower.match(/^(?:in\s+)?(\d+)\s*([a-z]+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const u = normalizeUnit(m[2]);
      if (!u || n <= 0) return null;
      const runAt = now + n * UNIT_MS[u];
      return { kind: 'once', runAt: runAt, display: 'once at ' + iso(runAt) };
    }

    // 3. ONCE (absolute) — an ISO-8601-ish timestamp.
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const t = Date.parse(raw);
      if (!isNaN(t)) return { kind: 'once', runAt: t, display: 'once at ' + iso(t) };
    }

    // 4. CRON — deterministic 5-field subset: numeric fields with *, lists, ranges, and steps.
    const cron = parseCronExpression(raw);
    if (cron) {
      if (tz != null) cron.tz = tz;                         // attach the (already-validated) IANA tz
      if (nextCronFireAt(cron, now, tzFor(cron, null)) != null) return cron;
    }

    return null;
  }

  /* nextFireAt(schedule, lastRunIso, now, opts?) — the SINGLE next fire time strictly after the anchor
     (the last run if present, else now). Returns null when there is no future fire (a once-job that
     has already run, or an invalid cron schedule). opts.defaultTz is applied to a tz-LESS cron schedule
     (the host injects its real tz here) — a schedule's own tz always wins. Pure: no clock read. */
  function nextFireAt(schedule, lastRunIso, now, opts) {
    if (!schedule) return null;
    now = now || 0;
    const defaultTz = opts && opts.defaultTz != null ? opts.defaultTz : null;
    if (schedule.kind === 'once') {
      if (lastRunIso) return null;            // one-shot already ran -> permanently ineligible
      return schedule.runAt;
    }
    if (schedule.kind === 'interval') {
      const p = periodMs(schedule);
      if (p <= 0) return null;
      const parsed = lastRunIso ? Date.parse(lastRunIso) : NaN;
      const anchor = isNaN(parsed) ? now : parsed;
      return anchor + p;                      // the next occurrence one period after the anchor
    }
    if (schedule.kind === 'cron') {
      const parsed = lastRunIso ? Date.parse(lastRunIso) : NaN;
      const anchor = isNaN(parsed) ? now : parsed;
      return nextCronFireAt(schedule, anchor, tzFor(schedule, defaultTz));
    }
    return null;
  }

  /* computeGraceMs(schedule, anchor, defaultTz?) — how late a recurring fire may be and still run once
     (vs being declared a stale missed run and fast-forwarded). Mirrors the reference harness's half-period clamped
     2min..2h. The cron branch measures the inter-fire gap in the schedule's tz so a DST-stretched day
     still yields a sane grace. */
  function computeGraceMs(schedule, anchor, defaultTz) {
    if (schedule && schedule.kind === 'interval') {
      return Math.max(2 * MIN, Math.min(2 * HOUR, periodMs(schedule) / 2));
    }
    if (schedule && schedule.kind === 'cron') {
      const base = anchor || 0;
      const zone = tzFor(schedule, defaultTz);
      const first = nextCronFireAt(schedule, base, zone);
      const second = first != null ? nextCronFireAt(schedule, first, zone) : null;
      if (first != null && second != null) return Math.max(2 * MIN, Math.min(2 * HOUR, (second - first) / 2));
    }
    return 5 * MIN;                            // unused for once-jobs (they fire whenever first noticed)
  }

  /* misfirePolicy(job) — what to do with a recurring fire noticed PAST its grace window (2026-07-15
     reliability audit). 'fire_once' collapses the whole missed backlog into ONE catch-up run (a 9:00 daily
     noticed at 12:01 still does the day's work, exactly once); 'skip' fast-forwards without running (the
     pre-policy behavior). job.misfire is the explicit per-job setting; when absent the DEFAULT is derived
     from the schedule: cron schedules and SLOW intervals (period >= 1h — daily-ish work whose output is
     still wanted late) fire_once, FAST intervals skip (a missed 5-minute poll is worthless by the next one).
     Either way the fast-forward to the next FUTURE occurrence still happens — never a backlog burst. */
  function misfirePolicy(job) {
    const m = job && job.misfire;
    if (m === 'skip' || m === 'fire_once') return m;
    const sched = job && job.schedule;
    if (sched && sched.kind === 'cron') return 'fire_once';
    if (sched && sched.kind === 'interval') return periodMs(sched) >= HOUR ? 'fire_once' : 'skip';
    return 'skip';
  }

  // current due time for a job: the persisted nextRunAt if present, else freshly computed. ms | null.
  function dueAtOf(job, now, defaultTz) {
    if (job && job.nextRunAt) { const t = Date.parse(job.nextRunAt); return isNaN(t) ? null : t; }
    return nextFireAt(job && job.schedule, job && job.lastRunAt, now, { defaultTz: defaultTz });
  }

  /* planTick(jobs, now, opts?) — the entire scheduler tick expressed as DATA (no side effects). For each
     ENABLED job it decides: fire now / skip-as-caught-up / leave alone, and what next-fire to persist.
       fire    : [{ jobId, scheduledFor }]               the jobs to launch this tick
       skipped : [{ jobId, reason, scheduledFor }]       stale recurring jobs fast-forwarded (no backlog)
       next    : [{ jobId, nextAt, prevAt }]             the advanced next-fire to persist (advance-before-run)
     The host (index.js) applies this: persist `next`, then launch `fire`, emitting cron.* events.
     opts.defaultTz is the host's injected tz, applied to any tz-LESS cron schedule.
     Disabled/invalid schedules are ignored entirely (no skip noise). */
  function planTick(jobs, now, opts) {
    now = now || 0;
    const defaultTz = opts && opts.defaultTz != null ? opts.defaultTz : null;
    // G4.5: the one-shot fire-claim ceiling. A one-shot with a claim younger than this is treated as
    // in-flight (NOT due → no re-fire); a claim AT/PAST this age is a zombie (a crashed holder) → reclaimed.
    // Injected by the host (the same lease ceiling cron-driver uses). Defaults to 8min if not supplied.
    const maxRunMs = opts && opts.maxRunMs != null ? opts.maxRunMs : (8 * 60 * 1000);
    // NS-0 LEASE HEARTBEAT: the staleness ceiling for the in-flight liveness heartbeat. A one-shot whose
    // heartbeat is FRESHER than this is provably still running (its driver keeps renewing it on run progress),
    // so it is NOT re-fired NO MATTER how old the wall-clock fireClaim is — this is the fix for the duplicate
    // fire where a >maxRunMs research run was wrongly declared a zombie and re-fired. A STALE heartbeat (the
    // holder process crashed — heartbeats stopped) falls through to the fireClaim zombie reclaim below so a
    // truly-dead run is still recovered. Injected by the host (cron-driver threads its computed value). Default
    // = maxRunMs, so absent a heartbeat this reduces to the exact pre-NS-0 zombie-reclaim timing (a heartbeat
    // only ever EXTENDS liveness past the fixed ceiling; it never shortens it). Matches the cron-driver default.
    const heartbeatStaleMs = opts && opts.heartbeatStaleMs != null ? opts.heartbeatStaleMs : maxRunMs;
    const fire = [], skipped = [], next = [];
    for (const job of (jobs || [])) {
      if (!job || job.enabled === false) continue;
      const sched = job.schedule;
      if (!isFireable(sched)) continue;
      if (sched.kind === 'once' && job.lastRunAt) continue;     // one-shot already ran (settled)

      // G4.5 ONE-SHOT FIRE-CLAIM: a one-shot carrying a FRESH claim has a run in flight — suppress re-fire
      // so a crash-restart inside the window does NOT double-fire. A ZOMBIE claim (age >= maxRunMs, a crashed
      // holder) falls through and re-fires. markRun clears the claim on settlement, so a transient-failed
      // one-shot (claim cleared, lastRunAt still null) re-arms via its backoff nextRunAt rather than being
      // suppressed here.
      if (sched.kind === 'once' && job.fireClaim != null) {
        // NS-0: a FRESH heartbeat proves the run is still alive → suppress re-fire regardless of claim age.
        // This is what makes a legitimately-long research run fire EXACTLY ONCE: as long as its driver keeps
        // renewing heartbeatAt (on run-progress events), age-of-claim never triggers a zombie reclaim.
        if (job.heartbeatAt != null) {
          // NEGATIVE age (a backwards clock step — NTP correction, manual set) means the stamp is in the
          // future: that is unambiguously NOT stale, so it must suppress like a fresh beat. Requiring
          // age >= 0 here made both in-flight guards fall through on a clock rewind and DOUBLE-FIRED a
          // genuinely-running one-shot across a restart.
          const beatAge = now - job.heartbeatAt;
          if (beatAge < heartbeatStaleMs) continue;   // fresh (or future-stamped) heartbeat → in-flight → not due
          // else: heartbeat stale (holder crashed — beats stopped) → fall through to the claim reclaim below
        }
        const claimAge = now - job.fireClaim;
        if (claimAge < maxRunMs) continue;     // fresh (or future-stamped) claim → in-flight → not due
        // else: zombie claim → fall through and re-fire (reclaim)
      }

      const dueAt = dueAtOf(job, now, defaultTz);
      if (dueAt == null || isNaN(dueAt) || dueAt > now) continue;   // not due yet (or no computable fire)

      if (sched.kind === 'once') {
        // fire a one-shot whenever we first notice it is due — never silently drop a scheduled run.
        // The host stamps a fire-claim (claimOnceFire) and persists it BEFORE launching; markRun then sets
        // lastRunAt on settlement, making it permanently ineligible.
        fire.push({ jobId: job.id, scheduledFor: dueAt });
        continue;                                              // one-shots don't recur -> no `next`
      }

      // recurring (interval or cron)
      const lateness = now - dueAt;
      if (lateness <= computeGraceMs(sched, dueAt, defaultTz)) {
        // DRIFT FIX: an INTERVAL advances from the SCHEDULED instant (dueAt + k*period, smallest k that lands
        // in the future), never from the tick instant — anchoring on `now` walked an hourly routine later by
        // up to one tick per fire. A cron schedule is wall-clock-anchored already, so `now` is exact for it.
        let nextAt = null;
        if (sched.kind === 'interval') {
          const p = periodMs(sched);
          if (!(p > 0)) continue;                    // NaN-safe: NaN <= 0 is false, but !(NaN > 0) is true
          /* RE-ANCHOR AFTER A TRANSIENT RETRY: markRun's backoff rewinds nextRunAt to now+backoff so the
             SAME occurrence retries — but advancing from that instant phase-shifted the interval
             PERMANENTLY (+backoff per transient failure, compounding forever; the header's own no-walk
             promise). retryAnchorAt (stamped by the backoff, cleared on terminal settlement) preserves
             the occurrence the schedule had already advanced to; the interval advances from IT. */
          const ra = job.retryAnchorAt ? Date.parse(job.retryAnchorAt) : NaN;
          const anchor = isFinite(ra) ? ra : dueAt;
          nextAt = anchor > now ? anchor : anchor + (Math.floor((now - anchor) / p) + 1) * p;
        } else {
          nextAt = nextRecurringAt(sched, now, defaultTz);
        }
        if (nextAt == null || !isFinite(nextAt)) continue;   // a NaN advance would throw iso(NaN) out of the whole tick
        fire.push({ jobId: job.id, scheduledFor: dueAt });
        next.push({ jobId: job.id, nextAt: nextAt, prevAt: dueAt });
      } else {
        // stale missed run: fast-forward to the next FUTURE occurrence (at-most-one catch-up, never a
        // backlog burst) — then the job's MISFIRE POLICY decides whether the missed occurrence still runs
        // ONCE (fire_once) or is dropped (skip). Intervals use O(1) arithmetic; cron the bounded search.
        let nextAt = null;
        if (sched.kind === 'interval') {
          const p = periodMs(sched);
          if (!(p > 0)) continue;                    // NaN-safe (see the on-time branch)
          // same retry re-anchor as the on-time branch above — a stale backoff instant is not the schedule
          const ra = job.retryAnchorAt ? Date.parse(job.retryAnchorAt) : NaN;
          const anchor = isFinite(ra) ? ra : dueAt;
          nextAt = anchor > now ? anchor : anchor + (Math.floor((now - anchor) / p) + 1) * p;   // smallest k with anchor + k*p > now
        } else if (isRecurring(sched)) {
          nextAt = nextRecurringAt(sched, now, defaultTz);
        }
        if (nextAt == null || !isFinite(nextAt)) continue;   // NaN-safe (see the on-time branch)
        next.push({ jobId: job.id, nextAt: nextAt, prevAt: dueAt });
        if (misfirePolicy(job) === 'fire_once') {
          // the backlog collapses to ONE catch-up run: advance-before-run still persists the FUTURE
          // nextRunAt above, so a crash mid-catch-up never re-fires and there is never a burst.
          fire.push({ jobId: job.id, scheduledFor: dueAt });
        } else {
          skipped.push({ jobId: job.id, reason: 'caught-up', scheduledFor: dueAt });
        }
      }
    }
    return { fire: fire, skipped: skipped, next: next };
  }

  /* dueJobs(jobs, now, opts?) — the no-backlog PAIR: the fire set AND the advanced next-fire that must be
     persisted together (advancing nextFireAt without the planTick fast-forward loses the guarantee). */
  function dueJobs(jobs, now, opts) {
    const r = planTick(jobs, now, opts);
    return { fire: r.fire, advanced: r.next };
  }

  return {
    parseSchedule: parseSchedule,
    nextFireAt: nextFireAt,
    planTick: planTick,
    dueJobs: dueJobs,
    computeGraceMs: computeGraceMs,
    misfirePolicy: misfirePolicy,
    periodMs: periodMs,
    isValidTz: isValidTz,
    isFireable: isFireable,
    _internals: {
      normalizeUnit: normalizeUnit,
      humanDuration: humanDuration,
      iso: iso,
      dueAtOf: dueAtOf,
      parseCronExpression: parseCronExpression,
      nextCronFireAt: nextCronFireAt,
      isValidTz: isValidTz,
      localFieldsOf: localFieldsOf,
      tzFor: tzFor
    }
  };
});
