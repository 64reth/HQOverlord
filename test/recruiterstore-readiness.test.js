'use strict';
const A = require('./_assert.js');
let ready = false, recommendCalls = 0, gapCalls = 0;
global.UnderstandingStore = { readiness: () => ({ ready, reasons: ready ? [] : ['no-direction'] }) };
global.ProfileStore = { enabled: () => true, score: () => 1 };
global.WorkSignalStore = { model: () => ({ lanes: {}, total: 4 }) };
global.DossierStore = { beliefs: () => [{ text: 'ship the station' }] };
global.App = { agents: () => [] };
global.ProspectStore = { interests: () => [{ label: 'release automation', weight: 1 }] };
global.Specialties = { builtins: () => [{ id: 'researcher' }], get: id => ({ id }) };
global.Recruiter = {
  recommend: () => { recommendCalls++; return { warm: true, items: [{ classId: 'researcher' }] }; },
  interestGaps: () => { gapCalls++; return { items: [{ topic: 'release automation' }] }; }
};
const { RecruiterStore } = require('../frontend/app/recruiterstore.js');

A.eq(RecruiterStore.recommend(), { warm: false, items: [] }, 'cold understanding blocks personalized recruitment');
A.eq(RecruiterStore.interestGaps(), { items: [] }, 'cold understanding blocks proactive interest-gap hiring');
A.eq(recommendCalls + gapCalls, 0, 'the matchers are not even invoked before shared readiness');
ready = true;
A.eq(RecruiterStore.recommend().warm, true, 'shared readiness unlocks personalized recruitment');
A.eq(RecruiterStore.interestGaps().items.length, 1, 'the same gate unlocks interest-gap recommendations');
A.eq(recommendCalls, 1, 'the ready path calls the recruiter once');
A.eq(gapCalls, 1, 'the ready path calls the gap matcher once');

A.report('recruiterstore-readiness.test');
