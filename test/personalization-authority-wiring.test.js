'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
const weights = source.match(/function nightshiftPreferenceWeights\(\) \{[\s\S]*?\n\}/);
const decide = source.match(/function nightshiftDecideLearn\([\s\S]*?\n\}/);

A.ok(weights, 'night-shift effective preference seam exists');
A.ok(weights && /if \(!enabled\) return \{\};/.test(weights[0]), 'pause suppresses every preference source before weights are assembled');
A.ok(weights && /effectivePreferenceWeights\(model, legacy, true\)/.test(weights[0]), 'legacy history and shared evidence meet at one pure authority seam');
A.ok(decide && /recommendationLedger\.verdict/.test(decide[0]), 'new return-card verdicts update the shared recommendation ledger');
A.ok(decide && !/learnFold|saveResilient\(NIGHTSHIFT_LEARN_FILE/.test(decide[0]), 'new verdicts are not double-written to the legacy learn store');
A.ok(/preferenceTallies\(nightshiftPreferenceWeights\(\)\)/.test(source), 'context packs consume the same effective preference model used for ranking');

A.report('personalization-authority-wiring.test');
