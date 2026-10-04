/* node test/queryspine-wiring.test.js — browser load order and first cron-family migration lock. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const index = read('frontend/index.html');
const harnessAt = index.indexOf('app/harness.js');
const spineAt = index.indexOf('app/queryspine.js');
const firstConsumerAt = index.indexOf('app/routinenudgestore.js');
A.ok(harnessAt >= 0 && harnessAt < spineAt && spineAt < firstConsumerAt,
  'queryspine loads after Harness.api and before every migrated cron consumer');

const spine = read('frontend/app/queryspine.js');
A.ok(/Harness\.api\.get/.test(spine), 'browser JSON reads use Harness.api.get');
A.ok(/define\('cron',[\s\S]*path:\s*'\/api\/cron'/.test(spine), 'the cron key has one canonical route definition');

for (const file of ['widgets.js', 'routinenudgestore.js', 'returnstore.js', 'autojobstore.js']) {
  const src = read('frontend/app/' + file);
  A.ok(/QuerySpine/.test(src), file + ' reads cron through the shared resource');
  A.ok(!/fetch\s*\(\s*['"]\/api\/cron['"]\s*,\s*\{\s*cache\s*:/.test(src),
    file + ' owns no direct GET /api/cron request');
}

const widgets = read('frontend/app/widgets.js');
const routines = read('frontend/app/windows/routines.js');
A.ok(/await QuerySpine\.refresh\('cron'\)/.test(routines),
  'routine edits publish their verified read-back to widgets through the shared scheduler query');
A.ok(!/setInterval\s*\(\s*pollCron/.test(widgets) && !/function\s+pollCron/.test(widgets),
  'widgets owns no cron poll timer');
A.ok(/QuerySpine\.subscribe\('cron',\s*foldCron\)/.test(widgets),
  'widgets subscribes to the shared cron state');

const app = read('frontend/app/app.js');
const jobsStart = app.indexOf('getExistingJobs:');
const jobsEnd = app.indexOf('scheduleJob:', jobsStart);
const jobsSlice = app.slice(jobsStart, jobsEnd);
A.ok(/QuerySpine\.refresh\('cron'\)/.test(jobsSlice), 'AutoJobStore live-name dependency uses the shared forced refresh');
A.ok(!/fetch\s*\(\s*['"]\/api\/cron/.test(jobsSlice), 'AutoJobStore live-name dependency has no private cron GET');

A.report('queryspine-wiring.test');
