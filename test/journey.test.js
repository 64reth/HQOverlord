/* node test/journey.test.js — pure Commander journey presentation helpers. */
'use strict';
const A = require('./_assert.js');
const J = require('../frontend/app/journey.js');

A.eq(J.domainOf('Ship and deploy the SaaS app'), 'building', 'shipping product work maps to building');
A.eq(J.domainOf('Reach $10k MRR with customer retention'), 'growth', 'business outcomes map to growth');
A.eq(J.domainOf('Draft the launch email'), 'writing', 'writing work maps to writing');
A.eq(J.domainOf('something with no supported signal'), null, 'uncertain text stays unclassified instead of inventing mastery');
A.eq(J.metricProgress({ baseline: 100, current: 550, target: 1000, direction: 'atLeast' }), { pct: 50, reached: false }, 'ascending metric progress is bounded and truthful');
A.eq(J.metricProgress({ baseline: 10, current: 3, target: 2, direction: 'atMost' }), { pct: 88, reached: false }, 'descending metrics report progress in the correct direction');
A.eq(J.metricProgress({ baseline: 10, current: 1, target: 2, direction: 'atMost' }).reached, true, 'at-most metric reaches only at or below target');
A.eq(J.metricProgress({ baseline: 1, current: 1, target: 1 }), null, 'zero-span metric cannot fabricate a percent');
A.report('journey.test');
