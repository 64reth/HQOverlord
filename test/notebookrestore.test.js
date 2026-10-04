/* node test/notebookrestore.test.js — pure memory-restore helpers (M-save P2).
   Proves: sanitizeNotes drops junk/empty notes, fills a deterministic id when missing, coerces ts; mergeNotes
   is ADDITIVE (existing wins on an id collision, only genuinely-new notes are added) so an import can never
   destroy or mutate memory the agent already has. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const { sanitizeNotes, mergeNotes } = require('../sidecar/notebookrestore.js');

// ---- A. sanitizeNotes: keep well-formed, drop junk, coerce ts, fill missing id deterministically ----
{
  A.eq(sanitizeNotes(null), [], 'non-array -> []');
  A.eq(sanitizeNotes('nope'), [], 'string -> []');
  const clean = sanitizeNotes([
    { id: 'a', title: 'T', body: 'B', ts: 5 },
    { title: 'only title', body: '', ts: '12' },       // ts coerced from string
    { id: 'x', title: '', body: '' },                  // empty -> dropped
    null, 42,                                           // junk -> dropped
    { body: 'no id no title-ok' }                       // gets a deterministic fallback id
  ]);
  A.eq(clean.length, 3, 'kept 3 well-formed notes, dropped empty + junk');
  A.eq(clean[0].id, 'a', 'explicit id preserved');
  A.eq(clean[1].ts, 12, 'ts coerced to number');
  A.eq(clean[1].id, 'mem_r12_1', 'missing id derived from (ts,index) deterministically');
  A.eq(clean[2].id, 'mem_r0_5', 'missing ts -> 0 in the derived id');
  // determinism: same input -> identical ids
  A.eq(sanitizeNotes([{ body: 'b' }])[0].id, sanitizeNotes([{ body: 'b' }])[0].id, 'derived id is stable across calls');
}

// ---- B. richer cortex fields are preserved through sanitize ----
{
  const c = sanitizeNotes([{ id: 'm1', title: 't', body: 'b', ts: 1, trust: 0.9, useCount: 4, pinned: true }]);
  A.eq(c[0].trust, 0.9, 'extra field trust preserved');
  A.eq(c[0].useCount, 4, 'extra field useCount preserved');
  A.eq(c[0].pinned, true, 'extra field pinned preserved');
}

// ---- C. mergeNotes onto an EMPTY target = full copy (the fresh-machine restore) ----
{
  const inc = [{ id: 'a', title: 'A', body: '1', ts: 1 }, { id: 'b', title: 'B', body: '2', ts: 2 }];
  const m = mergeNotes([], inc);
  A.eq(m.length, 2, 'empty target gets the full backup');
  A.eq(m.map(n => n.id), ['a', 'b'], 'order preserved');
}

// ---- D. mergeNotes is ADDITIVE: existing wins on id collision, only new ids are added ----
{
  const existing = [{ id: 'a', title: 'KEEP', body: 'current', ts: 100 }];
  const incoming = [
    { id: 'a', title: 'OLD', body: 'from backup', ts: 1 },   // collision -> ignored, existing kept
    { id: 'c', title: 'NEW', body: 'added', ts: 2 }          // genuinely new -> added
  ];
  const m = mergeNotes(existing, incoming);
  A.eq(m.length, 2, 'one collision ignored, one new added');
  A.eq(m[0].title, 'KEEP', 'existing note NOT overwritten by the backup');
  A.eq(m[0].body, 'current', 'existing body preserved');
  A.eq(m[1].id, 'c', 'new note appended after existing');
  A.eq(m[1].title, 'NEW', 'new note content added');
}

// ---- E. junk in either side is sanitized before the merge (never throws) ----
{
  const m = mergeNotes([null, { id: 'a', title: 't', body: 'b' }], ['x', { id: 'a', title: 'dup' }, { id: 'b', body: 'new' }]);
  A.eq(m.length, 2, 'junk dropped from both sides; a-collision ignored; b added');
  A.eq(m.map(n => n.id), ['a', 'b'], 'merged ids');
}

A.report('notebookrestore.test');
