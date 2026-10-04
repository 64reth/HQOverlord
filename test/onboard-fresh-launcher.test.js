/* node test/onboard-fresh-launcher.test.js — the cold-start launcher must stay cold.

   SKYNET_DEV is the pre-onboarded seed switch: the sidecar injects a configured model/provider
   hint and the frontend resumes the golden agent. dev/onboard-fresh.js exists to exercise the
   opposite path, so passing that flag makes its live proof silently test the wrong flow. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../dev/onboard-fresh.js'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '../dev/README.md'), 'utf8');

A.ok(/SKYNET_WORKSPACES:\s*SCRATCH/.test(src), 'cold-start launcher isolates its workspace');
A.ok(/SKYNET_PORT:\s*port/.test(src), 'cold-start launcher forwards its selected port');
A.ok(!/SKYNET_DEV\s*:/.test(src), 'cold-start launcher does not enable the pre-onboarded DEV seed path');
A.ok(/no `SKYNET_DEV`, no seed/.test(readme), 'developer instructions require the same cold-start boundary');

A.report('onboard-fresh-launcher.test');
