/* node test/cron-human.test.js — the schedule TRANSLATOR (frontend/app/cronhuman.js), locked against the
   REAL parser it feeds (sidecar/cron.js). Two properties matter here and nothing else does:

     1. EVERYTHING THE PICKER CAN BUILD, THE SCHEDULER CAN PARSE. build() is the only thing standing between
        a beginner's clicks and POST /api/cron, so every mode is round-tripped through cron.parseSchedule
        and checked for the right kind — not against a regex of what we THINK the parser accepts.
     2. A DESCRIPTION IS NEVER A GUESS. describeExpr must agree with the fire times cron.js actually
        computes (asserted against nextFireAt, not against itself), and must return null — so the caller
        falls back to the raw expression — for every shape it cannot state exactly.

   Pure module + pure parser, so no clock is read: `NOW` is a fixed epoch passed into both. */
'use strict';
const A = require('./_assert.js');
const CH = require('../frontend/app/cronhuman.js');
const cron = require('../sidecar/cron.js');

const NOW = Date.parse('2026-08-13T14:00:00Z');   // a Thursday
const TZ = 'America/New_York';

// what a cron expression ACTUALLY does, read back off the scheduler's own math
function fireLocal(expr, tz, n) {
  const sched = cron.parseSchedule(expr, NOW, { tz: tz });
  if (!sched) return null;
  const out = [];
  let t = cron.nextFireAt(sched, null, NOW, { defaultTz: tz });
  for (let i = 0; i < (n || 1) && t != null; i++) {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true, day: 'numeric'
    }).formatToParts(t).reduce((a, x) => (a[x.type] = x.value, a), {});
    out.push(p);
    t = cron.nextFireAt(sched, new Date(t).toISOString(), t, { defaultTz: tz });
  }
  return out;
}

/* ---------------- 1. BUILD -> the scheduler parses it ---------------- */

const daily = CH.build({ mode: 'daily', hour: 9, minute: 0 });
A.eq(daily, '0 9 * * *', 'daily 9:00 builds the plain cron the scheduler wants');
A.eq((cron.parseSchedule(daily, NOW, { tz: TZ }) || {}).kind, 'cron', 'daily parses as cron');

const weekly = CH.build({ mode: 'weekly', hour: 9, minute: 0, days: [2] });
A.eq(weekly, '0 9 * * 2', 'every Tuesday 9:00 builds a dow-restricted cron');
A.eq((cron.parseSchedule(weekly, NOW, { tz: TZ }) || {}).kind, 'cron', 'weekly parses as cron');

const multi = CH.build({ mode: 'weekly', hour: 17, minute: 30, days: [5, 1, 3] });
A.eq(multi, '30 17 * * 1,3,5', 'multiple days build one sorted, deduped list');
A.eq((cron.parseSchedule(multi, NOW, { tz: TZ }) || {}).kind, 'cron', 'multi-day weekly parses');

A.eq(CH.build({ mode: 'weekly', hour: 9, minute: 0, days: [] }), '',
  'weekly with NO day picked builds an empty schedule — never a silent daily');
A.eq(CH.build({ mode: 'weekly', hour: 9, minute: 0, days: [0, 1, 2, 3, 4, 5, 6] }), '0 9 * * *',
  'all seven days collapse to the daily form');

const monthly = CH.build({ mode: 'monthly', hour: 8, minute: 15, dom: 1 });
A.eq(monthly, '15 8 1 * *', 'monthly builds a day-of-month cron');
A.eq((cron.parseSchedule(monthly, NOW, { tz: TZ }) || {}).kind, 'cron', 'monthly parses as cron');

const iv = CH.build({ mode: 'interval', every: 30, unit: 'm' });
A.eq(iv, 'every 30m', 'the timer mode builds the interval form');
A.eq((cron.parseSchedule(iv, NOW) || {}).kind, 'interval', 'interval parses as interval');
A.eq((cron.parseSchedule(iv, NOW) || {}).minutes, 30, 'interval carries the right period');
A.eq(CH.build({ mode: 'interval', every: 0, unit: 'h' }), '', 'a zero interval builds nothing');

const once = CH.build({ mode: 'once', hour: 9, minute: 0, date: '2026-09-01', offsetMinutes: -240 });
A.eq(once, '2026-09-01T09:00:00-04:00', 'once builds an absolute instant carrying the caller offset');
const onceSched = cron.parseSchedule(once, NOW);
A.eq(onceSched && onceSched.kind, 'once', 'once parses as a one-shot');
A.eq(onceSched && onceSched.runAt, Date.parse('2026-09-01T13:00:00Z'), 'the offset pins the real instant');
A.eq(CH.build({ mode: 'once', hour: 9, minute: 0, date: 'soon' }), '', 'a malformed date builds nothing');

A.eq(CH.offsetSuffix(0), 'Z', 'a zero offset is Z');
A.eq(CH.offsetSuffix(330), '+05:30', 'a half-hour zone formats correctly');
A.eq(CH.offsetSuffix(null), '', 'no offset -> no suffix');
A.eq(CH.build({ mode: 'advanced', raw: '  0 9 * * 1-5  ' }), '0 9 * * 1-5', 'custom mode passes the raw string through');

/* ---------------- 2. DESCRIBE agrees with the scheduler ---------------- */

A.eq(CH.describeExpr('0 9 * * *'), 'every day at 9:00 AM', 'daily reads as English');
A.eq(CH.describeExpr('0 9 * * 2'), 'every Tuesday at 9:00 AM', 'a single weekday names the day');
A.eq(CH.describeExpr('0 9 * * 1-5'), 'every weekday at 9:00 AM', 'mon-fri is "every weekday"');
A.eq(CH.describeExpr('30 17 * * 1,3,5'), 'every Mon, Wed & Fri at 5:30 PM', 'a day list reads as a list');
A.eq(CH.describeExpr('0 0 * * 0,6'), 'every weekend day at 12:00 AM', 'midnight is 12:00 AM, not 0:00');
A.eq(CH.describeExpr('0 12 * * *'), 'every day at 12:00 PM', 'noon is 12:00 PM');
A.eq(CH.describeExpr('15 8 1 * *'), 'the 1st of every month at 8:15 AM', 'day-of-month reads as an ordinal');
A.eq(CH.describeExpr('0 9 22 * *'), 'the 22nd of every month at 9:00 AM', 'ordinals past the teens are right');
A.eq(CH.describeExpr('*/15 * * * *'), 'every 15 minutes', 'a minute step is a cadence');
A.eq(CH.describeExpr('0 */6 * * *'), 'every 6 hours', 'an hour step is a cadence');
A.eq(CH.describeExpr('30 */6 * * *'), 'every 6 hours at :30', 'an offset minute is stated, never dropped');

// the load-bearing check: the SENTENCE must match what the scheduler will really do.
const tue = fireLocal('0 9 * * 2', TZ, 3);
A.ok(tue && tue.length === 3 && tue.every(p => p.weekday === 'Tuesday' && p.hour === '9' && p.minute === '00'),
  '"every Tuesday at 9:00 AM" matches the next three real fire times — ' + JSON.stringify(tue));
const wk = fireLocal('0 9 * * 1-5', TZ, 5);
A.ok(wk && wk.every(p => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].indexOf(p.weekday) >= 0),
  '"every weekday" never fires on a weekend — ' + JSON.stringify(wk && wk.map(p => p.weekday)));
const first = fireLocal('15 8 1 * *', TZ, 2);
A.ok(first && first.every(p => p.day === '1' && p.hour === '8' && p.minute === '15'),
  '"the 1st of every month at 8:15 AM" matches the real fire times — ' + JSON.stringify(first));

/* ---------------- 3. A DESCRIPTION IS NEVER A GUESS ---------------- */

A.eq(CH.describeExpr('0 9,17 * * *'), null, 'a two-time schedule is not described (we would have to pick one)');
A.eq(CH.describeExpr('0 9 1 * 1'), null, 'the cron dom-OR-dow case is refused rather than mis-stated');
A.eq(CH.describeExpr('0 9 * 3 *'), null, 'a month restriction is refused');
A.eq(CH.describeExpr('0 9 * * MON'), null, 'named days are outside the parsed subset — refused');
A.eq(CH.describeExpr('bogus'), null, 'garbage is refused');
A.eq(CH.describeExpr('0 9 * *'), null, 'a 4-field expression is refused');
// …and every refusal falls back to the exact input, so the panel still shows the truth.
A.eq(CH.describeDisplay('cron 0 9,17 * * *'), 'cron 0 9,17 * * *', 'an undescribable cron renders verbatim');
A.eq(CH.describeDisplay('cron 0 9 * * 2'), 'every Tuesday at 9:00 AM', 'a describable cron renders as English');
A.eq(CH.describeDisplay('every 30m'), 'every 30 minutes', 'interval displays expand to words');
A.eq(CH.describeDisplay('every 1h'), 'every hour', 'a period of one drops the "1"');
A.eq(CH.describeDisplay('every 6h'), 'every 6 hours', 'plural periods keep the number');
A.eq(CH.describeDisplay(''), '', 'an empty display stays empty');
A.eq(CH.describeDisplay('something new'), 'something new', 'an unknown display shape is passed through untouched');
A.eq(CH.describeDisplay('once at 2026-09-01T13:00:00.000Z', { tz: TZ }), 'once — Tue, Sep 1 at 9:00 AM',
  'a one-shot renders in the caller\'s zone');
A.eq(CH.describeDisplay('once at not-a-date'), 'once at not-a-date', 'an unparseable one-shot renders verbatim');

/* ---------------- 4. TO-SPEC: an existing routine opens on the right mode ---------------- */

const rt = s => CH.build(CH.toSpec(s));
A.eq(rt('0 9 * * *'), '0 9 * * *', 'daily round-trips through the picker unchanged');
A.eq(rt('cron 0 9 * * 2'), '0 9 * * 2', 'a cron DISPLAY string round-trips (the prefix is stripped)');
A.eq(rt('30 17 * * 1,3,5'), '30 17 * * 1,3,5', 'a multi-day weekly round-trips');
A.eq(rt('15 8 1 * *'), '15 8 1 * *', 'monthly round-trips');
A.eq(rt('every 30m'), 'every 30m', 'an interval round-trips');
A.eq(CH.toSpec('0 9 * * 2').mode, 'weekly', 'a dow cron opens on the WEEKLY tab');
A.eq(CH.toSpec('15 8 1 * *').mode, 'monthly', 'a dom cron opens on the MONTHLY tab');
A.eq(CH.toSpec('every 6h').mode, 'interval', 'an interval opens on the TIMER tab');
A.eq(CH.toSpec('0 9,17 * * *').mode, 'advanced', 'anything the builder cannot model opens on CUSTOM');
A.eq(CH.toSpec('0 9,17 * * *').raw, '0 9,17 * * *', '…holding the original expression, losslessly');
A.eq(CH.toSpec('once at 2026-09-01T13:00:00.000Z').raw, '2026-09-01T13:00:00.000Z',
  'a one-shot opens on CUSTOM holding a string the parser still accepts');
A.eq((cron.parseSchedule(CH.toSpec('once at 2026-09-01T13:00:00.000Z').raw, NOW) || {}).kind, 'once',
  '…and that string really does parse');

A.report('cron-human.test');
