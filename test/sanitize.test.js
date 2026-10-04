/* node test/sanitize.test.js — tool-call argument repair (L2.S1).
   Every broken-but-recoverable input must yield parseable JSON; unrecoverable input degrades to '{}';
   the bounded passes must TERMINATE on a pathological payload (no spin). Pure, deterministic. */
'use strict';
const A = require('./_assert.js');
const { repairToolCallArguments, _internals } = require('../sidecar/providers/sanitize.js');

// the core contract: the repaired string ALWAYS parses
function repaired(raw) {
  const out = repairToolCallArguments(raw);
  let val, threw = false;
  try { val = JSON.parse(out); } catch (e) { threw = true; }
  A.ok(!threw, 'repair("' + String(raw).slice(0, 30).replace(/\n/g, '\\n') + '") -> parseable JSON, got: ' + out);
  return { out, val };
}

// ---- A. already-valid passes through unchanged ----
{
  A.eq(repairToolCallArguments('{"q":"hi","n":3}'), '{"q":"hi","n":3}', 'valid JSON returned verbatim');
  A.eq(repaired('{"q":"hi"}').val, { q: 'hi' }, 'valid parses to the right value');
}

// ---- B. empties / python-ish nulls -> {} ----
{
  A.eq(repairToolCallArguments(''), '{}', 'empty -> {}');
  A.eq(repairToolCallArguments('   '), '{}', 'whitespace -> {}');
  A.eq(repairToolCallArguments('None'), '{}', 'python None -> {}');
  A.eq(repairToolCallArguments(null), '{}', 'null arg -> {}');
  A.eq(repairToolCallArguments(undefined), '{}', 'undefined arg -> {}');
}

// ---- C. trailing comma ----
{
  A.eq(repaired('{"a":1,}').val, { a: 1 }, 'trailing comma in object repaired');
  A.eq(repaired('{"a":[1,2,]}').val, { a: [1, 2] }, 'trailing comma in array repaired');
}

// ---- D. unclosed delimiters ----
{
  A.eq(repaired('{"a":1').val, { a: 1 }, 'unclosed brace closed');
  A.eq(repaired('{"a":[1,2').val, { a: [1, 2] }, 'unclosed bracket closed');
  A.eq(repaired('{"path":"report.md"').val, { path: 'report.md' }, 'real-world unclosed object closed');
}

// ---- E. unclosed STRING (dangling quote) ----
{
  A.eq(repaired('{"a":"foo').val, { a: 'foo' }, 'dangling string closed then object closed');
}

// ---- F. raw control chars inside a string (literal tab / newline) ----
{
  A.eq(repaired('{"k":"a\tb"}').val, { k: 'a\tb' }, 'literal tab inside string escaped');
  A.eq(repaired('{"k":"line1\nline2"}').val, { k: 'line1\nline2' }, 'literal newline inside string escaped');
  // a control char OUTSIDE strings (already-valid JSON with whitespace) is untouched
  A.eq(repaired('{\n  "a": 1\n}').val, { a: 1 }, 'whitespace newlines between tokens are fine');
}

// ---- G. excess trailing closers ----
{
  A.eq(repaired('{"a":1}}').val, { a: 1 }, 'doubled closing brace stripped');
  A.eq(repaired('{"a":[1]]}').val, { a: [1] }, 'excess bracket stripped');
}

// ---- H. composed: needs trailing-comma + control-escape + append all at once ----
{
  A.eq(repaired('{"a":"x\ty",\n"b":[1,').val, { a: 'x\ty', b: [1] }, 'multiple defects repaired together');
}

// ---- I. unrepairable -> {} (never throws) ----
{
  A.eq(repairToolCallArguments('this is not json at all'), '{}', 'garbage -> {}');
  A.eq(repairToolCallArguments('{"a": @@@ }'), '{}', 'invalid token -> {}');
}

// ---- J. pathological deep-unbalanced payload TERMINATES under the iteration cap ----
{
  const bomb = '{'.repeat(500) + '"a":1';     // 500 unclosed braces > MAX_ITERS appends
  const out = repairToolCallArguments(bomb);   // must return (not hang); append is bounded, so it degrades to {}
  A.eq(out, '{}', 'deep-unbalanced payload bounded -> {}');
  A.ok(_internals.MAX_ITERS === 50, 'iteration cap is 50');
}

// ---- K. internals: each helper is pure and bounded ----
{
  A.eq(_internals.stripTrailingCommas('[1,2,]'), '[1,2]', 'stripTrailingCommas');
  A.eq(_internals.balanceDelimiters('{"a":[1'), '{"a":[1]}', 'balanceDelimiters appends missing closers in order');
  A.eq(_internals.balanceDelimiters('{"a":1}}'), '{"a":1}', 'balanceDelimiters drops a spurious closer');
  A.eq(_internals.escapeControlsInStrings('{"a":"x\ty"}'), '{"a":"x\\u0009y"}', 'escapeControlsInStrings escapes only in-string controls');
  A.eq(_internals.tryParse('{"a":1}').ok, true, 'tryParse ok=true on valid');
  A.eq(_internals.tryParse('{').ok, false, 'tryParse ok=false on invalid');
}

A.report('sanitize.test');
