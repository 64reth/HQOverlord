/* node test/dossierinject.test.js — the pure cron-path dossier folder (sidecar/dossierinject.js).
   Locks Phase C's server-side injection: withDossier appends the Commander block to a server-composed
   persona; an empty block is a strict no-op (byte-identical — the cron no-op invariant); it never
   double-appends a block already present; and it never throws on odd inputs. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const { withDossier } = require('../sidecar/dossierinject.js');

const PERSONA = 'You are an autonomous STARNET station agent running a SCHEDULED routine.';
const BLOCK = 'WHAT YOU KNOW ABOUT YOUR COMMANDER:\n- Stack & tools: TypeScript';

/* ---------- append ---------- */
A.eq(withDossier(PERSONA, BLOCK), PERSONA + '\n\n' + BLOCK, 'appends the dossier block after the persona');
A.eq(withDossier('', BLOCK), BLOCK, 'an empty persona yields just the block');

/* ---------- the no-op invariant: an empty/whitespace block leaves the persona byte-identical ---------- */
A.eq(withDossier(PERSONA, ''), PERSONA, 'an empty block is a strict no-op (byte-identical)');
A.eq(withDossier(PERSONA, '   \n  '), PERSONA, 'a whitespace-only block is a no-op');
A.eq(withDossier(PERSONA, null), PERSONA, 'a null block is a no-op');
A.eq(withDossier(PERSONA, undefined), PERSONA, 'an undefined block is a no-op');

/* ---------- idempotent: never double-append ---------- */
const once = withDossier(PERSONA, BLOCK);
A.eq(withDossier(once, BLOCK), once, 'a system already containing the block is returned unchanged (no double-append)');

/* ---------- defensive inputs ---------- */
A.eq(withDossier(null, null), '', 'null/null → empty string, never throws');
A.eq(withDossier(null, BLOCK), BLOCK, 'a null persona with a block → the block');
A.notThrows(() => withDossier(42, 7), 'non-string inputs do not throw');

A.report('dossierinject.test');
