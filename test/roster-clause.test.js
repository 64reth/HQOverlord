/* node test/roster-clause.test.js — the orchestrator's identity must never freeze a crew-size claim.
   The old baked "right now its only agent" clause turned into an app-lie the moment the Commander
   summoned a crew (truthful-telemetry law). The fix has three legs, all locked here:
     · identity.md gets a TIMELESS orchestrator clause (orchestratorClause) — no crew-size assertion
     · the LIVE crew truth rides rosterClause(), derived fresh in composeSystemPrompt like
       approvalClause/foundationClause — plus recomposeOrchestrators() at every roster-change point
       (summon / resume-rehydrate / crew rename), since the composed prompt is a stored snapshot
     · old saves migrate via stripLegacySoloClause — literal-guarded, idempotent, and byte-equal to
       a fresh baseIdentity afterwards (so setAgentName's untouched-default detection keeps working)
   app.js is a browser-flow module (not node-loadable), so wiring is locked against the source and
   the three self-contained clause/migration functions are extracted + executed directly. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const appjs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');

// ---- extract the self-contained pieces and RUN them (they only reference each other) ----
const grab = (re, what) => { const m = appjs.match(re); A.ok(m, what + ' found in app.js source'); return m ? m[0] : ''; };
const src =
  grab(/function baseIdentity\(name, role\) \{[\s\S]*?\n  \}/, 'baseIdentity') + '\n' +
  grab(/function orchestratorClause\(\) \{[\s\S]*?\n  \}/, 'orchestratorClause') + '\n' +
  grab(/const LEGACY_SOLO_CLAUSE = [\s\S]*?needs them\.';/, 'LEGACY_SOLO_CLAUSE') + '\n' +
  grab(/function stripLegacySoloClause\(a\) \{[\s\S]*?\n  \}/, 'stripLegacySoloClause');
const X = new Function(src + '\nreturn { baseIdentity, orchestratorClause, LEGACY_SOLO_CLAUSE, stripLegacySoloClause };')();

// ---- A. the fresh orchestrator identity is TIMELESS: no crew-size claim to go stale ----
const fresh = X.baseIdentity('ULTRA', 'orchestrator');
A.ok(fresh.indexOf('OVERSEER') !== -1, 'orchestrator identity still names the OVERSEER role');
A.ok(fresh.indexOf('right now its only agent') === -1, 'no frozen "only agent" claim in a fresh identity');
A.ok(fresh.indexOf('you gain a team.dispatch tool') === -1, 'no frozen tool-arrival promise in a fresh identity');
A.ok(fresh.indexOf(X.orchestratorClause()) !== -1, 'baseIdentity composes the shared orchestratorClause (single source for the migration)');
A.ok(X.baseIdentity('ULTRA', 'specialist').indexOf('OVERSEER') === -1, 'specialists never get the overseer clause');

// ---- B. migration: legacy baked block -> byte-equal to a fresh default ----
const core = X.baseIdentity('ULTRA', 'specialist');               // the role-free identity paragraph
const legacy = { docs: { identity: core + X.LEGACY_SOLO_CLAUSE } };  // exactly what old saves carry
X.stripLegacySoloClause(legacy);
A.eq(legacy.docs.identity, fresh, 'migrated identity is BYTE-EQUAL to a fresh baseIdentity (rename default-detection preserved)');
X.stripLegacySoloClause(legacy);
A.eq(legacy.docs.identity, fresh, 'migration is idempotent (second pass is a no-op)');
const reworded = { docs: { identity: 'You are ULTRA, hand-authored by the Commander.' } };
X.stripLegacySoloClause(reworded);
A.eq(reworded.docs.identity, 'You are ULTRA, hand-authored by the Commander.', 'a Commander-reworded identity is never touched');
X.stripLegacySoloClause({});   // no docs at all
A.ok(true, 'migration tolerates a doc-less agent');

// ---- C. rosterClause: derived fresh in composeSystemPrompt, never stored in identity.md ----
A.ok(/function rosterClause\(a\) \{/.test(appjs), 'rosterClause exists');
A.ok(/a\.role !== 'orchestrator'\) return ''/.test(appjs), 'rosterClause is orchestrator-only (specialist prompts unchanged)');
A.ok(/function composeSystemPrompt\(a\) \{[\s\S]{0,400}p \+= rosterClause\(a\);/.test(appjs), 'composeSystemPrompt folds the crew posture in right after identity');
A.ok(/YOUR CREW: none yet/.test(appjs), 'solo posture stays truthful (only-agent claim now lives where it is derived fresh)');
A.ok(/When you run as the station\\'s lead/.test(appjs), 'the crew clause is LEAD-conditional (the same base prompt runs the hero as a dispatched worker with no delegation tools)');

// ---- D. the cached-systemPrompt trap: every roster-change point recomposes the orchestrators ----
A.ok(/function recomposeOrchestrators\(\) \{/.test(appjs), 'recomposeOrchestrators exists');
A.ok(/function summonAgent[\s\S]{0,6000}recomposeOrchestrators\(\);[\s\S]{0,400}pushRoster\(\)/.test(appjs), 'summon recomposes the lead BEFORE the roster push (the pushed prompt carries the new worker)');
A.ok(/function resumeInto[\s\S]{0,900}stripLegacySoloClause\(agent\)/.test(appjs), 'resume migrates the hero identity');
A.ok(/rehydrateRoster\(saved\.agents\);[\s\S]{0,400}recomposeOrchestrators\(\)/.test(appjs), 'resume recomposes AFTER the crew rehydrates (the hero composes before the registry fills)');
A.ok(/function setAgentName[\s\S]{0,2600}recomposeOrchestrators\(\)/.test(appjs), 'a crew rename reaches the lead\'s YOUR CREW clause');
A.ok(/agentDocs\(agent\);\s*\/\/ seed identity\.md[\s\S]{0,300}registerHero\(agent\);[\s\S]{0,400}agent\.systemPrompt = composeSystemPrompt\(agent\)/.test(appjs), 'wake registers the hero BEFORE composing (a same-session re-wake must not see the prior crew)');

A.report('roster-clause.test');
