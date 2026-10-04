'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const harness = fs.readFileSync(path.join(root, 'frontend', 'app', 'harness.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'frontend', 'app', 'chat.js'), 'utf8');
const mirrorHarness = fs.readFileSync(path.join(root, 'website', 'app', 'app', 'harness.js'), 'utf8');
const mirrorChat = fs.readFileSync(path.join(root, 'website', 'app', 'app', 'chat.js'), 'utf8');

A.eq(harness, mirrorHarness, 'website harness mirror carries the same recovery client');
A.eq(chat, mirrorChat, 'website chat mirror carries the same recovery behavior');
A.ok(/mode: 'automatic'/.test(harness) && /continuationToken/.test(harness), 'browser prepares the typed one-shot automatic continuation');
A.ok(/r\.canAutoContinue/.test(chat), 'chat only auto-starts a server-proven safe recovery');
A.ok(/operationalState === 'needs_review'/.test(chat), 'review-required recovery has a distinct UI path');
A.ok(/StarNet will not repeat it/.test(chat), 'uncertain mutation copy states the no-duplicate guarantee');
A.ok(/It happened/.test(chat) && /It did not happen/.test(chat) && /I am not sure/.test(chat), 'uncertain mutation presents explicit outcome choices');
A.ok(/resolveRunRecovery/.test(harness) && /prepareReviewedRecovery/.test(harness), 'review decisions persist before reviewed continuation starts');
A.ok(/recovery: recoveryResume \? opts\.recovery : undefined/.test(chat), 'recovery re-enters the ordinary Harness.chat execution path');
A.ok(!/last run was interrupted and can\\'t resume/.test(chat), 'obsolete unconditional cannot-resume claim is gone');

A.report('run-recovery-ui.test');
