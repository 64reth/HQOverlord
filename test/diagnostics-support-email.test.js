/* node test/diagnostics-support-email.test.js â€” the support-email seam (frontend/app/diagnostics.js).

   Trust/honesty guard: an UNSET or still-PLACEHOLDER support address must NEVER render literally to a user. The
   render sites (Settings copy + copy-success toast) gate every email clause through Diag.supportEmail(): a real
   address passes through; a placeholder/empty/malformed value normalizes to '' so the clause is omitted (no fake
   address). This locks that normalizer + the hasSupport() bool the sites branch on. Pure â€” no DOM/fetch touched. */
'use strict';
const A = require('./_assert.js');
const Diag = require('../frontend/app/diagnostics.js');
const { normSupport, SUPPORT_PLACEHOLDER } = Diag._internals;

// ---- the build placeholder is NEVER a real address (the exact ship-blocker the audit named) ----
{
  A.eq(normSupport(SUPPORT_PLACEHOLDER), '', 'the ANDREW_SUPPORT_EMAIL placeholder normalizes to "" â€” never shown literally');
  A.eq(normSupport('ANDREW_SUPPORT_EMAIL'), '', 'the raw placeholder string also normalizes to ""');
}

// ---- unset / empty / whitespace => no address ----
{
  A.eq(normSupport(''), '', 'empty string => ""');
  A.eq(normSupport(null), '', 'null => ""');
  A.eq(normSupport(undefined), '', 'undefined => ""');
  A.eq(normSupport('   '), '', 'whitespace-only => ""');
}

// ---- not-a-plausible-email junk => no address (never render a non-address) ----
{
  A.eq(normSupport('support'), '', 'a bare word (no @) => ""');
  A.eq(normSupport('not an email'), '', 'spaced junk => ""');
  A.eq(normSupport('@nodomain'), '', 'missing local part => ""');
  A.eq(normSupport('nolocal@'), '', 'missing domain part => ""');
}

// ---- a real address passes through (trimmed) ----
{
  A.eq(normSupport('help@starnet.app'), 'help@starnet.app', 'a plausible address passes through unchanged');
  A.eq(normSupport('  help@starnet.app  '), 'help@starnet.app', 'surrounding whitespace is trimmed');
  A.eq(normSupport('androo.agi@gmail.com'), 'androo.agi@gmail.com', 'the current shipped address is valid');
}

// ---- the live seam: whatever THIS build ships, supportEmail()/hasSupport() agree with each other ----
{
  const dest = Diag.supportEmail();
  A.eq(typeof dest, 'string', 'supportEmail() always returns a string (never undefined/null)');
  A.eq(Diag.hasSupport(), dest !== '', 'hasSupport() is exactly (supportEmail() !== "")');
  // if THIS build has an address, it must be a real one (not the placeholder) â€” the ship-blocker assertion.
  if (dest) A.ok(dest !== SUPPORT_PLACEHOLDER && /^[^@\s]+@[^@\s]+$/.test(dest), 'a configured support address is a real email, never the placeholder');
}

// report() LAST — it is what calls process.exit(fail?1:0). This file used to end in a bare
// console.log, so every assertion failure printed FAIL and STILL exited 0: the fast gate scored
// it green no matter what broke. Never end an _assert.js test any other way.
A.report('diagnostics-support-email.test');
