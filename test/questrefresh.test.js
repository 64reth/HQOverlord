/* node test/questrefresh.test.js — the pure quest-refresh engine (sidecar/questrefresh.js, QUEST V3).
   Locks the standing-refresh promises: decide() fires on the 24h cadence and on the caught-up fast path
   (zero open quests past the cooldown) and binds honestly otherwise; parseContract enforces the contract
   rule (no 'run', no unplaceable prop, no unsweepable fact); parse() round-trips a well-formed multi-quest
   reply, dedups against the open slate + the dismissed-forever denylist + earlier blocks in the SAME reply,
   caps at MAX_MINTS_PER_CYCLE, and kills an ungrounded WHY; NONE is a sentinel; reducers are pure + capped;
   the Commander's active goal always outranks an inferred north star at the setNorthStar seam (source flag).
   Deterministic — injected now, no ambient clock. */
'use strict';
const A = require('./_assert.js');
const R = require('../sidecar/questrefresh.js');

const T0 = 1000000000000;
const DAY = R.REFRESH_EVERY_MS;
const GAP = R.CAUGHT_UP_GAP_MS;
const PROPS = ['dish', 'cabinet', 'notebook', 'workbench', 'studio', 'connector', 'computer', 'compute'];

/* ---------- decide: the two triggers + honest bindings ---------- */
let s = R.fresh();
A.ok(R.decide(s, { now: T0, openCount: 5 }).fire, 'a never-cycled state is due (daily clock starts at epoch)');
A.eq(R.decide(s, { now: T0, openCount: 5 }).why, 'daily', 'never-cycled fires as the daily pass');
s = R.stampCycle(s, { now: T0 });
A.eq(R.decide(s, { now: T0 + GAP + 1, openCount: 2 }, ).binding, 'cooldown', 'open quests + inside 24h -> cooldown binds');
A.eq(R.decide(s, { now: T0 + 1, openCount: 0 }).binding, 'gap', 'caught up but inside the cooldown -> gap binds');
const dCaught = R.decide(s, { now: T0 + GAP + 1, openCount: 0 });
A.ok(dCaught.fire, 'caught up past the cooldown fires');
A.eq(dCaught.why, 'caught-up', 'the caught-up fast path is named');
const dDaily = R.decide(s, { now: T0 + DAY + 1, openCount: 9 });
A.ok(dDaily.fire && dDaily.why === 'daily', '24h elapsed fires regardless of open count');

/* ---------- parseContract: the contract rule, enforced at the parse seam ---------- */
A.eq(R.parseContract('prop dish', PROPS), { type: 'prop', key: 'dish' }, 'prop with a placeable key parses');
A.eq(R.parseContract('prop DISH', PROPS), { type: 'prop', key: 'dish' }, 'prop keys normalize case');
A.eq(R.parseContract('prop teleporter', PROPS), null, 'an unplaceable prop key is an uncompletable quest — rejected');
A.eq(R.parseContract('artifact out/plan.md', PROPS), { type: 'artifact', key: 'out/plan.md' }, 'artifact keeps its path key');
A.eq(R.parseContract('artifact', PROPS), null, 'artifact without a path is rejected');
A.eq(R.parseContract('fact ships a video every week', PROPS), { type: 'fact', key: 'ships a video every week' }, 'fact keeps its phrase');
A.eq(R.parseContract('fact ab', PROPS), null, 'a fact key shorter than the sweep minimum can never complete — rejected');
A.eq(R.parseContract('attest', PROPS), { type: 'attest', key: '' }, 'attest carries the empty key (Commander-confirm completes it)');
A.eq(R.parseContract('run r123', PROPS), null, 'run is not in the refresh vocabulary (nothing to bind)');
A.eq(R.parseContract('', PROPS), null, 'empty contract rejected');

/* ---------- buildDirective: evidence + vocabulary + the goal-vs-inference precedence ---------- */
const dirGoal = R.buildDirective({ goalNote: 'Current goal: Launch the channel (1/4 milestones done).', dossierBlock: 'Goals: grow an audience', activityBlock: '• edited episode 3', openQuests: [{ title: 'Write the outline' }], deniedTitles: ['old chore'], propKeys: PROPS });
A.ok(dirGoal.indexOf('ACTIVE GOAL') >= 0 && dirGoal.indexOf('Launch the channel') >= 0, 'an active goal leads the directive as the north star');
A.ok(dirGoal.indexOf('Write the outline') >= 0, 'open slate is shown for dedup');
A.ok(dirGoal.indexOf('old chore') >= 0, 'dismissed-forever titles are shown');
A.ok(dirGoal.indexOf('dish, cabinet') >= 0, 'the honest prop vocabulary is spelled out');
const dirNS = R.buildDirective({ northStar: { text: 'Become a full-time creator' }, propKeys: PROPS });
A.ok(dirNS.indexOf('CURRENT NORTH STAR') >= 0 && dirNS.indexOf('full-time creator') >= 0, 'a prior inferred star is re-shown, not re-derived');
A.ok(R.buildDirective({ propKeys: PROPS }).indexOf('NO NORTH STAR IS KNOWN YET') >= 0, 'a cold state asks for the inference');
// PROGRESSION + RELEVANCE blocks
const dirProg = R.buildDirective({ goalNote: 'Current goal: Launch.', interestsBlock: '• davinci color grading (asked 4x)', completedQuests: [{ title: 'Publish episode 3' }], propKeys: PROPS });
A.ok(dirProg.indexOf('RECURRING INTERESTS THE STATION OBSERVED') >= 0 && dirProg.indexOf('davinci color grading') >= 0, 'the interest histogram rides the directive');
A.ok(dirProg.indexOf('RECENTLY COMPLETED') >= 0 && dirProg.indexOf('Publish episode 3') >= 0, 'completed quests ride as the progression anchor');
A.ok(dirProg.indexOf('NEXT step along the same path') >= 0, 'the directive commands progression, not a reshuffle');
A.ok(R.buildDirective({ goalNote: 'g', propKeys: PROPS }).indexOf('RECENTLY COMPLETED') < 0, 'no completed quests -> no empty progression block');

/* ---------- slateFull: the cap-full fast path (cost + honesty) ---------- */
// mirrors quest-store OPEN_GENERATED_CAP (3). At/over the ceiling a refresh can mint nothing new, so the
// ambient half must SKIP the paid model call — this pure predicate is that gate (no model call downstream of it).
A.eq(R.OPEN_GENERATED_CAP, 3, 'the refresh mirrors the store open-generated cap');
A.eq(R.slateFull(0), false, 'an empty slate is not full — a cycle may run');
A.eq(R.slateFull(2), false, 'below the cap the model call is still worth paying for');
A.eq(R.slateFull(R.OPEN_GENERATED_CAP), true, 'AT the cap the slate is full — skip the (foregone-rejected) model call');
A.eq(R.slateFull(R.OPEN_GENERATED_CAP + 1), true, 'over the cap stays full');
A.eq(R.slateFull(-5), false, 'a junk negative count is not full');
A.eq(R.slateFull('x'), false, 'a junk non-numeric count is not full');

/* ---------- hasEvidence: the cold-save guard ---------- */
A.eq(R.hasEvidence({}), false, 'a fully cold save has no evidence');
A.eq(R.hasEvidence({ goalNote: '', dossierBlock: '  ', activityBlock: '' }), false, 'whitespace is not evidence');
A.eq(R.hasEvidence({ goalNote: 'Current goal: X' }), true, 'an active goal is evidence');
A.eq(R.hasEvidence({ northStar: { text: 'Ship it' } }), true, 'a prior north star is evidence');
A.eq(R.hasEvidence({ interestsBlock: '• kubernetes ops' }), true, 'observed interests are evidence');
A.eq(R.hasEvidence({ activityBlock: '• ran a research task' }), true, 'real activity is evidence');

/* ---------- parse: round-trip, dedup, grounding, caps, NONE ---------- */
const GROUNDING = 'Goals: grow the youtube channel to sustainable income\n• edited episode 3 of the interview series';
const GOOD = [
  'NORTH_STAR: Grow the channel into a sustainable income',
  'QUEST: Publish episode 3',
  'DESC: Finish the edit and get episode 3 live.',
  'REWARD: a published episode driving the channel forward',
  'DOMAIN: creative',
  'CONTRACT: attest',
  'STEPS: final cut; thumbnail; upload',
  'WHY: you edited episode 3 of the interview series this week',
  'QUEST: Automate the research brief',
  'DESC: Stand up the web dish so an agent can compile guest research.',
  'REWARD: research on tap for every episode',
  'DOMAIN: research',
  'CONTRACT: prop dish',
  'WHY: the channel goals need recurring guest research',
  'QUEST: Write the outline',
  'DESC: dup of an open quest.',
  'REWARD: none',
  'CONTRACT: attest',
  'WHY: the channel goals need it'
].join('\n');
const p1 = R.parse(GOOD, { openTitles: ['Write the outline'], deniedTitles: [], propKeys: PROPS, grounding: GROUNDING });
A.eq(p1.none, false, 'a QUEST-bearing reply is not NONE');
A.eq(p1.northStar && p1.northStar.text, 'Grow the channel into a sustainable income', 'north star line parses');
A.eq(p1.quests.length, 2, 'the open-slate duplicate is dropped, the two real quests survive');
A.eq(p1.quests[0].contract, { type: 'attest', key: '' }, 'attest contract rides through');
A.eq(p1.quests.map(q => q.domain), ['creative', 'research'], 'valid mastery domains round-trip with refreshed quests');
A.eq(p1.quests[0].steps, [{ key: 's1', label: 'final cut' }, { key: 's2', label: 'thumbnail' }, { key: 's3', label: 'upload' }], 'STEPS split into keyed steps');
A.eq(p1.quests[1].contract, { type: 'prop', key: 'dish' }, 'prop contract clamps to the vocabulary');
A.ok(p1.quests[1].groundedIn.indexOf('guest research') >= 0, 'WHY becomes groundedIn');
A.eq(R.normalize({ pendingQuests: p1.quests }).pendingQuests.map(q => q.domain), ['creative', 'research'], 'pending refresh slate preserves mastery domains across restart');
const badDomain = R.parse('QUEST: Valid without a domain\nDOMAIN: money\nCONTRACT: attest\nWHY: grow the channel', { propKeys: PROPS, grounding: 'grow the channel' });
A.eq(badDomain.quests[0].domain, null, 'an invented domain never enters the mastery taxonomy');

// denylist + intra-reply dedup + the per-cycle cap
const DUPED = [
  'NORTH_STAR: x',
  'QUEST: Same title', 'CONTRACT: attest', 'WHY: grow the channel with research',
  'QUEST: Same title', 'CONTRACT: attest', 'WHY: grow the channel with research',
  'QUEST: Old chore', 'CONTRACT: attest', 'WHY: grow the channel with research',
  'QUEST: Fresh one', 'CONTRACT: attest', 'WHY: grow the channel with research',
  'QUEST: Also fine', 'CONTRACT: attest', 'WHY: grow the channel with research',
  'QUEST: Over the cap', 'CONTRACT: attest', 'WHY: grow the channel with research'
].join('\n');
const p2 = R.parse(DUPED, { openTitles: [], deniedTitles: ['old chore'], propKeys: PROPS, grounding: 'grow the channel with research' });
A.eq(p2.quests.map(q => q.title), ['Same title', 'Fresh one', 'Also fine'], 'intra-reply dup + denylisted title dropped; cap at 3 holds');

// grounding guard: an invented WHY dies at the parse seam
const INVENTED = ['QUEST: Buy a boat', 'CONTRACT: attest', 'WHY: sailing maximizes nautical synergy'].join('\n');
A.eq(R.parse(INVENTED, { openTitles: [], deniedTitles: [], propKeys: PROPS, grounding: GROUNDING }).quests.length, 0, 'a WHY citing nothing observed is rejected');

// load-bearing fields: a block missing CONTRACT or WHY is malformed
A.eq(R.parse('QUEST: No contract\nWHY: grow the channel', { propKeys: PROPS, grounding: 'grow the channel' }).quests.length, 0, 'missing contract -> dropped');
A.eq(R.parse('QUEST: No why\nCONTRACT: attest', { propKeys: PROPS }).quests.length, 0, 'missing WHY -> dropped');

// NONE sentinel (with and without a north-star line)
A.eq(R.parse('NONE', {}).none, true, 'bare NONE is the sentinel');
const pNone = R.parse('NORTH_STAR: Grow the channel\nNONE', {});
A.ok(pNone.none && pNone.northStar && pNone.northStar.text === 'Grow the channel', 'NONE may still carry the north star');

/* ---------- reducers: pure, capped, junk-tolerant ---------- */
let st = R.fresh();
for (let i = 0; i < R.LEDGER_CAP + 10; i++) st = R.note(st, { outcome: 'minted', reason: 'r' + i, title: 't' + i }, { now: T0 + i });
A.eq(st.ledger.length, R.LEDGER_CAP, 'ledger is FIFO-capped');
A.eq(st.ledger[st.ledger.length - 1].reason, 'r' + (R.LEDGER_CAP + 9), 'newest entry survives the cap');
st = R.setNorthStar(st, { text: 'Ship the product', groundedIn: 'dossier', source: 'model' }, { now: T0 });
A.eq(st.northStar.text, 'Ship the product', 'setNorthStar lands');
A.eq(st.northStar.source, 'model', 'inferred stars carry source model');
st = R.setNorthStar(st, { text: '', source: 'goal' }, { now: T0 + 1 });
A.eq(st.northStar.text, 'Ship the product', 'an empty star never blanks an existing one');
st = R.setNorthStar(st, { text: 'The Commander goal', source: 'goal' }, { now: T0 + 2 });
A.eq(st.northStar.source, 'goal', 'a Commander-goal star carries source goal');
/* ---------- north star PROPOSE-AND-CONFIRM (QUEST V3 slice 3): inferences are proposed, never silently adopted ---------- */
let n = R.fresh();
// a first inference is PROPOSED, not adopted — the effective star is it, labelled proposed; nothing adopted yet.
n = R.proposeNorthStar(n, { text: 'Grow the channel to a living', groundedIn: 'inferred', source: 'model' }, { now: T0 });
A.eq(n.northStar, null, 'an inference is NOT silently adopted');
A.eq(n.proposedNorthStar.text, 'Grow the channel to a living', 'the inference is stashed as a pending proposal');
A.eq(R.effectiveNorthStar(n).status, 'proposed', 'the effective star is labelled unconfirmed');
A.eq(R.effectiveNorthStar(n).text, 'Grow the channel to a living', 'the proposal grounds the cycle while pending');
// an identical proposal already pending is a no-op (asked once, not every cycle — no stamp reset)
const n2 = R.proposeNorthStar(n, { text: 'grow the CHANNEL to a living', source: 'model' }, { now: T0 + 5 });
A.eq(n2.proposedNorthStar.at, T0, 'an identical pending proposal is not re-stamped (anti-nag)');
// CONFIRM → adopted; the proposal clears; the effective star is now adopted.
let nc = R.confirmNorthStar(n, { now: T0 + 10 });
A.eq(nc.proposedNorthStar, null, 'confirm clears the proposal');
A.eq(nc.northStar.text, 'Grow the channel to a living', 'confirm adopts the star');
A.eq(R.effectiveNorthStar(nc).status, 'adopted', 'a confirmed star reads adopted');
// re-proposing the SAME text once adopted is a no-op (a re-affirmation needs no confirm)
A.eq(R.proposeNorthStar(nc, { text: 'Grow the channel to a living', source: 'model' }, { now: T0 + 20 }).proposedNorthStar, null, 'the adopted star is never re-proposed to itself');
// DECLINE → denylisted forever; the same inference never re-proposes; a DIFFERENT one still can.
let nd = R.declineNorthStar(n, { now: T0 + 30 });
A.eq(nd.proposedNorthStar, null, 'decline drops the proposal');
A.ok(nd.declinedNorthStars.indexOf('grow the channel to a living') >= 0, 'the declined inference is denylisted');
A.eq(R.proposeNorthStar(nd, { text: 'Grow the channel to a living', source: 'model' }, { now: T0 + 40 }).proposedNorthStar, null, 'a declined inference is never re-proposed');
A.eq(R.proposeNorthStar(nd, { text: 'Ship a SaaS product', source: 'model' }, { now: T0 + 50 }).proposedNorthStar.text, 'Ship a SaaS product', 'a different inference still proposes after a decline');
// a Commander GOAL always outranks + SUPERSEDES a pending proposal (adopted silently, proposal dropped)
let ng = R.setNorthStar(R.proposeNorthStar(R.fresh(), { text: 'a guess', source: 'model' }, { now: T0 }), { text: 'Launch the app', source: 'goal' }, { now: T0 + 1 });
A.eq(ng.proposedNorthStar, null, 'a Commander goal supersedes a pending inference proposal');
A.eq(ng.northStar.source, 'goal', 'the goal is the adopted star');
A.eq(ng.northStar.status, 'adopted', 'a goal star is adopted, never proposed');
// no-op verdicts when nothing pends
A.eq(R.confirmNorthStar(R.fresh(), { now: T0 }).northStar, null, 'confirm with no pending proposal is a no-op');
A.eq(R.declineNorthStar(R.fresh(), { now: T0 }).declinedNorthStars, [], 'decline with no pending proposal denylists nothing');
// durability: propose/decline state survives a JSON round-trip
const ndRT = R.normalize(JSON.parse(JSON.stringify(nd)));
A.ok(ndRT.declinedNorthStars.indexOf('grow the channel to a living') >= 0, 'the decline denylist survives a round-trip');
A.eq(R.effectiveNorthStar(R.fresh()), null, 'a cold state has no effective star');

// Quests inferred alongside an unconfirmed north star remain staged. They cannot steer autonomy or appear as
// adopted work until the Commander confirms the direction; decline clears both the proposal and its draft slate.
const stagedQuest = { title: 'Publish episode 4', contract: { type: 'attest', key: '' }, groundedIn: 'channel goal' };
let nsq = R.proposeNorthStar(R.fresh(), { text: 'Grow the channel', source: 'model' }, { now: T0 });
nsq = R.stageQuests(nsq, [stagedQuest]);
A.eq(R.pendingQuests(nsq).map(q => q.title), ['Publish episode 4'], 'quests wait behind an unconfirmed inferred direction');
A.eq(R.normalize(JSON.parse(JSON.stringify(nsq))).pendingQuests.length, 1, 'the pending quest slate survives restart');
A.eq(R.declineNorthStar(nsq, { now: T0 + 1 }).pendingQuests, [], 'declining the direction also drops its staged quests');
A.eq(R.clearPendingQuests(nsq).pendingQuests, [], 'pending quests have an explicit clear seam');

A.eq(R.normalize(null).ledger, [], 'normalize(null) is a fresh state');
A.eq(R.normalize({ northStar: { text: '' }, ledger: 'junk', lastCycleAt: 'x' }).northStar, null, 'junk hydrates safely');
const roundTrip = R.normalize(JSON.parse(JSON.stringify(st)));
A.eq(roundTrip.northStar.text, 'The Commander goal', 'state survives a JSON round-trip');

const changedBase = R.stampCycle(R.fresh(), { now: T0, contextKey: 'before' });
A.ok(!R.decide(changedBase, { now: T0 + R.MATERIAL_CHANGE_GAP_MS - 1, openCount: 2, contextKey: 'after' }).fire, 'progress changes coalesce under a cost debounce');
A.eq(R.decide(changedBase, { now: T0 + R.MATERIAL_CHANGE_GAP_MS, openCount: 2, contextKey: 'after' }).why, 'progress-changed', 'material change earns reactive planning');
A.ok(!R.decide(changedBase, { now: T0 + R.MATERIAL_CHANGE_GAP_MS, openCount: 2, contextKey: 'before' }).fire, 'unchanged progress does not call model');
A.eq(R.normalize(JSON.parse(JSON.stringify(changedBase))).contextKey, 'before', 'cost debounce fingerprint survives restart');
const pc = R.progressContext({ goals: [{ id: 'g', text: 'Find a job', successCondition: 'An accepted offer', status: 'active' }], metrics: [{ goalId: 'g', status: 'active', label: 'Interviews', current: 0, history: [{ value: 0, note: 'No replies', source: 'commander' }] }, { goalId: 'other', status: 'active', label: 'Unrelated' }], outcomes: [{ goalId: 'g', title: 'Sent applications', verifiedBy: 'commander-confirmed', evidence: 'Sent five' }] }, [{ title: 'Send more', disposition: { type: 'too_big', reason: 'Only 10 minutes available' } }], { id: 'g' });
A.eq(pc.goal.successCondition, 'An accepted offer', 'planner sees the registered success condition');
A.eq(pc.metrics.length, 1, 'planner metrics scoped to the active goal');
const pd = R.buildDirective({ goalNote: 'Find a job', progress: pc });
A.ok(pd.includes('No replies') && pd.includes('commander-confirmed') && pd.includes('Only 10 minutes available'), 'planner sees metric history, provenance and user constraints');
A.ok(pd.includes('Completed work does not prove the life goal happened'), 'planner separates activity from goal attainment');
const boundGoal = { id: 'g', text: 'Find a job', milestoneId: 'm1', next: 'Apply', done: 0, total: 3 };
A.eq(R.goalBinding(boundGoal), R.goalBinding({ ...boundGoal, pct: 99 }), 'nonbinding display percentage does not invalidate planning');
for (const change of [{ id: 'new' }, { text: 'Learn music' }, { milestoneId: 'm2' }, { next: 'Interview' }]) A.ok(R.goalBinding(boundGoal) !== R.goalBinding({ ...boundGoal, ...change }), 'goal and milestone changes invalidate planning');
A.report();
