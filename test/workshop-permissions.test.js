/* node test/workshop-permissions.test.js — the AWAY WORKSHOP consent refinement (W1).

   Proves the workshop grant clears the autonomous "silence is not consent" default-deny for a JAIL-SCOPED WRITE
   (cabinet = files, memory = notebook) by a GRANTED agent, and NOTHING else. The four ABSOLUTE INVARIANTS the
   plan pins are each asserted directly here:
     (a) autonomous EXECUTE stays denied exactly as today (permissions.js exec lockout untouched);
     (b) NON-jail tools are unchanged (a granted agent still can't autonomously write a non-cabinet/memory cap);
     (c) NON-granted agents are unchanged (default-deny stands with no grant);
     (d) the HARDLINE floor is unchanged (.env/.git denied even for a granted agent). */
'use strict';
const A = require('./_assert.js');
const { makeConsentBroker, SILENCE } = require('../sidecar/permissions.js');

// live tool shapes (capabilities as the real registry emits them — see sidecar/tools/builtin/fs.js/notebook.js).
const CABINET_WRITE = { name: 'fs.write', capability: 'cabinet', scope: 'write', requiresConsent: true };
const CABINET_READ = { name: 'fs.read', capability: 'cabinet', scope: 'read' };
const MEMORY_WRITE = { name: 'notebook.write', capability: 'memory', scope: 'write' };
const EXEC = { name: 'shell.exec', capability: 'workbench', scope: 'execute', requiresConsent: true };
const WEB_WRITE = { name: 'connector.post', capability: 'web', scope: 'write', network: true };  // a NON-jail write

const fsCall = { name: 'fs.write', args: { path: 'workshop/r1/tool.py' } };
const memCall = { name: 'notebook.write', args: { text: 'note' } };
const execCall = { name: 'shell.exec', args: { cmd: 'npm test' } };
const webCall = { name: 'connector.post', args: {} };

const hardline = (call) => (call && call.args && /(^|[\\/])\.env(\.|$)/.test(call.args.path)) ? 'protected file' : null;

// helpers: a broker for a GRANTED / UNGRANTED agent on a given surface.
const granted = (extra) => makeConsentBroker(Object.assign({ surface: 'autonomous', workshop: () => true }, extra || {}));
const ungranted = (extra) => makeConsentBroker(Object.assign({ surface: 'autonomous', workshop: () => false }, extra || {}));

// ---- 1. GRANTED agent: an autonomous cabinet:write is ALLOWED (the core new behavior) ----
{
  const r = granted()(fsCall, CABINET_WRITE);
  A.ok(r.allow === true, 'granted agent: autonomous cabinet:write allowed');
  A.ok(/workshop grant/.test(r.reason), 'reason names the workshop grant');
  A.eq(r.scope, 'write', 'scope echoed');
  // a memory (notebook) write is also jail-scoped -> allowed
  A.ok(granted()(memCall, MEMORY_WRITE).allow === true, 'granted agent: autonomous memory:write allowed');
}

// ---- 2. INVARIANT (a): EXECUTE stays denied for a granted agent (exec lockout untouched) ----
{
  const r = granted()(execCall, EXEC);
  A.ok(!r.allow, 'granted agent: autonomous execute STILL denied (exec lockout)');
  A.eq(r.reason, SILENCE, 'execute denial is the exec-lockout SILENCE, not a workshop allow');
  // even a pre-blessed permanent execute grant cannot enable autonomous shell for a workshop agent
  const blessed = granted({ grantsPermanent: new Set(['workbench:execute']) });
  A.ok(!blessed(execCall, EXEC).allow, 'granted agent + permanent exec grant: STILL denied (lockout above cache)');
}

// ---- 3. INVARIANT (b): NON-jail write stays denied for a granted agent ----
{
  const r = granted()(webCall, WEB_WRITE);
  A.ok(!r.allow, 'granted agent: a NON-jail (web) write is NOT unlocked by the workshop grant');
  A.eq(r.reason, SILENCE, 'non-jail write falls through to the default-deny');
}

// ---- 4. INVARIANT (c): NON-granted agent is unchanged (default-deny stands) ----
{
  const r = ungranted()(fsCall, CABINET_WRITE);
  A.ok(!r.allow, 'ungranted agent: autonomous cabinet:write default-denies exactly as today');
  A.eq(r.reason, SILENCE, 'ungranted reason is the silence rule');
  // no workshop dep at all == byte-identical legacy behavior
  const legacy = makeConsentBroker({ surface: 'autonomous' })(fsCall, CABINET_WRITE);
  A.ok(!legacy.allow && legacy.reason === SILENCE, 'no workshop predicate: legacy default-deny unchanged');
}

// ---- 5. INVARIANT (d): the HARDLINE floor still wins for a granted agent ----
{
  const b = granted({ hardline: hardline });
  const r = b({ name: 'fs.write', args: { path: '.env' } }, CABINET_WRITE);
  A.ok(!r.allow && r.hardline === true, 'granted agent: .env write STILL blocked by the hardline floor');
}

// ---- 6. surface guard: the grant does NOTHING on the INTERACTIVE surface (a live human already answers) ----
{
  // interactive with no prompt fails closed; the workshop predicate must not silently allow it.
  const b = makeConsentBroker({ surface: 'interactive', workshop: () => true });
  const r = b(fsCall, CABINET_WRITE);
  A.ok(!r.allow && /no consent channel/.test(r.reason), 'workshop grant does not bypass the interactive ask');
}

// ---- 7. read is unaffected (auto-allow path, no grant needed) and a thrown predicate fails closed ----
{
  A.ok(granted()(fsCall, CABINET_READ).allow === true, 'a jail read auto-allows regardless (read-only tier)');
  const boom = makeConsentBroker({ surface: 'autonomous', workshop: () => { throw new Error('store down'); } });
  const r = boom(fsCall, CABINET_WRITE);
  A.ok(!r.allow && r.reason === SILENCE, 'a throwing workshop predicate fails CLOSED (default-deny)');
}

// ---- 8. capability set is overridable (proves the gate is data-driven, not hardcoded to one cap) ----
{
  const b = makeConsentBroker({ surface: 'autonomous', workshop: () => true, workshopCaps: { drafts: true } });
  const DRAFT_WRITE = { name: 'x.write', capability: 'drafts', scope: 'write' };
  A.ok(b(fsCall, DRAFT_WRITE).allow === true, 'custom workshopCaps unlocks the named capability');
  A.ok(!b(fsCall, CABINET_WRITE).allow, 'a capability NOT in the custom set stays denied');
}

A.report('workshop-permissions.test');
