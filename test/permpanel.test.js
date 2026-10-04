'use strict';
// permpanel.test.js — the pure engine behind the Permissions Panel (autonomy B1): the never→full spectrum,
// the curated grant catalog, level↔posture derivation, and the reconcile diff. Plus a CROSS-LOCK that the
// frontend catalog and the sidecar's grantable set never drift. (Named permpanel.* so it never collides with
// the consent-broker's existing test/permissions.test.js.)
const assert = require('assert');
const P = require('../frontend/app/permissions.js');
const { GRANTABLE } = require('../sidecar/permgrants.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// --- the spectrum ---
eq(P.LEVELS, ['never', 'suggest', 'draft', 'full'], 'LEVELS is the low→high spectrum');
ok(P.isLevel('full') && !P.isLevel('nope'), 'isLevel');
eq(P.normalizeLevel('garbage'), 'never', 'unknown level normalizes to the safe floor (never)');
eq(P.normalizeLevel('draft'), 'draft', 'a valid level passes through');

// --- level plans (posture preset + standing grants) ---
eq(P.levelPlan('never'),   { preset: 'wait',    grants: [] }, 'never = wait + no grants');
eq(P.levelPlan('suggest'), { preset: 'suggest', grants: [] }, 'suggest = propose-preset + no grants');
eq(P.levelPlan('draft'),   { preset: 'build',   grants: [] }, 'draft = build-preset + no grants (drafts only)');
eq(P.levelPlan('full'),    { preset: 'free',    grants: ['cabinet:write'] }, 'full = free-preset + the write grant');
eq(P.levelPlan('junk'),    { preset: 'wait',    grants: [] }, 'a junk level falls back to never');

// the preset ids must be real autonomy.js cadence ids (cross-checked against its source).
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'autonomy.js'), 'utf8');
  for (const lvl of P.LEVELS) ok(new RegExp("id:\\s*'" + P.levelPlan(lvl).preset + "'").test(src), 'level ' + lvl + ' maps to a real cadence preset id: ' + P.levelPlan(lvl).preset);
}

// --- blurbs are honest + present ---
for (const lvl of P.LEVELS) ok(typeof P.describeLevel(lvl) === 'string' && P.describeLevel(lvl).length > 10, 'describeLevel(' + lvl + ') is a real sentence');
ok(/never/i.test(P.describeLevel('never')), "never's blurb says it never acts");
ok(/write|files/i.test(P.describeLevel('full')), "full's blurb mentions writing files");
ok(/can'?t|never/i.test(P.describeLevel('full')), "full's blurb still names the hard limits (can't send/spend/run)");

// --- the curated catalog ---
eq(P.grantableKeys(), ['cabinet:write'], 'the only grantable class is local file writes');
ok(P.isGrantable('cabinet:write') && !P.isGrantable('net:send'), 'isGrantable gates to the catalog');
eq(P.catalogLabel('cabinet:write'), 'Write files on its own', 'catalog label');
ok(P.describeGrant('cabinet:write').length > 20, 'curated grant has a real description');
ok(/revoke/i.test(P.describeGrant('net:send')), 'a NON-curated standing grant still gets a truthful, revocable line (nothing hidden)');

// --- CROSS-LOCK: frontend catalog keys === sidecar grantable set ---
eq(P.grantableKeys().slice().sort(), GRANTABLE.slice().sort(), 'panel catalog keys exactly match sidecar permgrants.GRANTABLE (no drift)');

// --- effectiveness (object=capability): a grant only takes EFFECT once its station object is placed ---
eq(P.grantObject('cabinet:write'), 'cabinet', 'cabinet:write needs the cabinet object placed to take effect');
eq(P.grantObject('net:send'), null, 'a grant with no object requirement → null');
ok(/INTEL CAB/i.test(P.objectHint('cabinet:write')), 'objectHint names the INTEL CAB to place (the real palette prop name)');
ok(P.grantEffective('cabinet:write', ['cabinet', 'workbench']) === true, 'effective when the cabinet is placed');
ok(P.grantEffective('cabinet:write', ['workbench']) === false, 'NOT effective without the cabinet (so the panel never claims a silent no-op writes files)');
ok(P.grantEffective('cabinet:write', null) === true, 'unknown caps → assumed effective (no false alarm)');
ok(P.grantEffective('net:send', ['cabinet']) === true, 'a no-object grant is always effective');
ok(/INTEL CAB/i.test(P.describeLevel('full')) || /INTEL CAB/i.test(P.catalogEntry('cabinet:write').desc), 'the full-level / catalog copy is honest about needing an INTEL CAB');

// --- normalizeGrants ---
eq(P.normalizeGrants(['cabinet:write', 'cabinet:write', 'BAD', 42, null, 'net:send']), ['cabinet:write', 'net:send'], 'normalizeGrants filters junk, dedups, sorts');
eq(P.normalizeGrants('nope'), [], 'normalizeGrants tolerates a non-array');
/* ⛔ THE SCOPE HALF OF A DANGER KEY IS NOT AN IDENTIFIER. The filter used to be /^[a-z_]+:[a-z]+$/, which
   dropped every real standing grant that is not the one curated key — folder trust (`path:<root>`, a Windows
   path with a drive colon, backslashes and spaces) and one-per-connector `mcp:<id>` grants. Filtered out here,
   they vanished from the Standing-Approvals ledger, which then printed the teaching empty-state while path
   trust was live and ENFORCED in the sidecar: a permission the Commander could neither see nor revoke. */
eq(P.normalizeGrants(['path:C:\\Users\\andro\\Projects']), ['path:C:\\Users\\andro\\Projects'], 'a Windows folder-trust grant survives normalization');
eq(P.normalizeGrants(['path:/home/a/My Work']), ['path:/home/a/My Work'], 'a POSIX path with a space survives');
eq(P.normalizeGrants(['mcp:github-mcp-2']), ['mcp:github-mcp-2'], 'a per-connector mcp grant survives');
eq(P.normalizeGrants(['shell.exec:execute']), ['shell.exec:execute'], 'a dotted capability class survives');
eq(P.normalizeGrants(['nocolon', ':noclass', 'cls:', 'bad:\u0007key']), [], 'still rejects a key with no class, no scope, or control characters');

// --- levelFromState (derive the current level from live posture + grants) ---
eq(P.levelFromState({ initiative: 'wait' }, []), 'never', 'wait + no grants → never');
eq(P.levelFromState({ initiative: 'propose' }, []), 'suggest', 'propose → suggest');
eq(P.levelFromState({ initiative: 'leash' }, []), 'draft', 'leash (acts) + no write → draft');
eq(P.levelFromState({ initiative: 'free' }, []), 'draft', 'free + no write grant → still draft');
eq(P.levelFromState({ initiative: 'free' }, ['cabinet:write']), 'full', 'free + write grant → fully autonomous');
eq(P.levelFromState({ initiative: 'leash' }, ['cabinet:write']), 'full', 'leash + write grant → full');
eq(P.levelFromState({ initiative: 'wait' }, ['cabinet:write']), 'never', 'orphan write grant under wait reads as never (not in effect)');
eq(P.levelFromState({ actsUnattended: true }, ['cabinet:write']), 'full', 'actsUnattended flag also counts as acting');

// --- reconcileToLevel (what to grant/revoke to reach a level — curated keys ONLY) ---
eq(P.reconcileToLevel('full', []), { toGrant: ['cabinet:write'], toRevoke: [] }, 'to full from nothing → grant write');
eq(P.reconcileToLevel('never', ['cabinet:write']), { toGrant: [], toRevoke: ['cabinet:write'] }, 'to never → revoke write');
eq(P.reconcileToLevel('full', ['cabinet:write']), { toGrant: [], toRevoke: [] }, 'already at full → no change');
eq(P.reconcileToLevel('draft', ['cabinet:write', 'net:send']), { toGrant: [], toRevoke: ['cabinet:write'] }, 'leveling down revokes the write grant but NEVER auto-touches a non-curated grant (net:send)');

// --- STANDING-APPROVALS ledger copy (P0-5): teaching empty state + provenance line ---
ok(/no standing approvals yet/i.test(P.emptyApprovals()), 'empty-state teaches how a row appears (answer ALWAYS)');
ok(/always/i.test(P.emptyApprovals()), 'empty-state names the ALWAYS answer that creates a standing grant');
eq(P.EMPTY_APPROVALS, P.emptyApprovals(), 'the empty-state constant and getter agree (single source of copy)');

// grantAgeText is deterministic given (grantedAt, now) — clock is injected, never read internally.
{
  const t = 1700000000000; const min = 60000, hr = 3600000, day = 86400000;
  ok(/just now/i.test(P.grantAgeText(t, t + 5000)), '5s → just now');
  ok(/5 mins ago/i.test(P.grantAgeText(t, t + 5 * min)), '5m → 5 mins ago');
  ok(/1 min ago/i.test(P.grantAgeText(t, t + 1 * min)), 'singular minute');
  ok(/3 hours ago/i.test(P.grantAgeText(t, t + 3 * hr)), '3h → 3 hours ago');
  ok(/2 days ago/i.test(P.grantAgeText(t, t + 2 * day)), '2d → 2 days ago');
  // legacy grants carry no timestamp — honest fallback, never a fabricated time.
  ok(/granted earlier/i.test(P.grantAgeText(null, t)), 'no grantedAt → "granted earlier" (never fabricated)');
  ok(/granted earlier/i.test(P.grantAgeText(undefined)), 'undefined grantedAt is tolerated');
}

console.log('permpanel.test.js OK —', n, 'assertions');
