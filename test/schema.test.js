/* node test/schema.test.js — unit tests for shared/schema.js */
'use strict';
const A = require('./_assert.js');
const { validate, typeOf } = require('../shared/schema.js');

const okv = (s, v, msg) => A.ok(validate(s, v).ok, msg);
const bad = (s, v, msg) => A.ok(!validate(s, v).ok, msg);

// typeOf
A.eq(typeOf(null), 'null', 'typeOf null');
A.eq(typeOf([]), 'array', 'typeOf array');
A.eq(typeOf(3), 'number', 'typeOf number');
A.eq(typeOf('x'), 'string', 'typeOf string');
A.eq(typeOf({}), 'object', 'typeOf object');
A.eq(typeOf(undefined), 'undefined', 'typeOf undefined');

// primitive types
okv({ type: 'string' }, 'hi', 'string ok');
bad({ type: 'string' }, 5, 'string rejects number');
okv({ type: 'boolean' }, false, 'boolean ok');
bad({ type: 'boolean' }, 0, 'boolean rejects 0');

// integer vs number, and finiteness
okv({ type: 'integer' }, 3, 'integer ok');
bad({ type: 'integer' }, 3.5, 'integer rejects float');
okv({ type: 'number' }, 3.5, 'number ok');
bad({ type: 'number' }, NaN, 'number rejects NaN');
bad({ type: 'number' }, Infinity, 'number rejects Infinity');

// type unions
okv({ type: ['string', 'null'] }, null, 'union accepts null');
okv({ type: ['string', 'null'] }, 'x', 'union accepts string');
bad({ type: ['string', 'null'] }, 5, 'union rejects number');

// enum
okv({ enum: ['a', 'b'] }, 'a', 'enum ok');
bad({ enum: ['a', 'b'] }, 'c', 'enum rejects unknown');
okv({ enum: [true] }, true, 'enum const true ok');
bad({ enum: [true] }, false, 'enum const true rejects false');

// objects: required + property types
const person = { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'integer' } } };
okv(person, { name: 'a', age: 2 }, 'object ok');
bad(person, { name: 'a' }, 'object missing required');
bad(person, { name: 'a', age: 'two' }, 'object wrong prop type');
okv(person, { name: 'a', age: 2, extra: 1 }, 'extra props allowed by default');

// additionalProperties: false
const strict = { type: 'object', properties: { a: { type: 'integer' } }, additionalProperties: false };
okv(strict, { a: 1 }, 'strict ok');
bad(strict, { a: 1, b: 2 }, 'strict rejects extra prop');

// arrays
const ints = { type: 'array', items: { type: 'integer' } };
okv(ints, [1, 2, 3], 'array ok');
bad(ints, [1, 'x'], 'array rejects bad element');

// nested
const nested = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: person } } };
okv(nested, { items: [{ name: 'a', age: 1 }] }, 'nested ok');
bad(nested, { items: [{ name: 'a' }] }, 'nested rejects bad inner');

// empty schema = no constraint
okv({}, 'anything', 'empty schema accepts anything');
okv({}, 12345, 'empty schema accepts numbers too');

// error messages are present on failure
A.ok(validate(person, {}).errors.length >= 2, 'reports an error per missing field');

// ---- OWN properties only. `in` walks the prototype chain, so every Object.prototype key read as
// present/declared: {q:'x',toString:1} passed additionalProperties:false and a required 'constructor' was
// satisfied by a property nobody supplied. MCP inputSchemas reach this validator verbatim.
{
  const closed = { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false };
  bad(closed, { q: 'x', evil: 1 }, 'an undeclared property is refused');
  bad(closed, { q: 'x', toString: 1 }, 'an undeclared Object.prototype NAME is refused too');
  bad(closed, { q: 'x', constructor: 1 }, 'including constructor');
  okv(closed, { q: 'x' }, 'a clean payload still passes');

  const needsProto = { type: 'object', required: ['toString'], properties: { toString: { type: 'string' } } };
  bad(needsProto, {}, 'a required prototype-NAMED field is not satisfied by Object.prototype');
  okv(needsProto, { toString: 'v' }, 'and passes when genuinely supplied');

  // a payload carrying its OWN hasOwnProperty must not shadow the check
  bad(closed, { q: 'x', hasOwnProperty: 1 }, 'a payload cannot disarm the check by shadowing hasOwnProperty');
}

A.report('schema.test');
