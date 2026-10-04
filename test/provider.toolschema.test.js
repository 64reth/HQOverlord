/* node test/provider.toolschema.test.js - tool JSON Schema repair for strict provider wires.

   REGRESSION THIS LOCKS: a third-party MCP connector's inputSchema used to reach Gemini's
   functionDeclarations verbatim (mcp/translate.js passes it through, registry.wireFormat() hands it
   over, gemini.js set `parameters: fn.parameters`). Gemini answers an unknown field with a 400 on
   EVERY turn, so one zod-authored connector took out every Gemini run. The old gemini test asserted
   pass-through using `{type:'object'}` — a schema with nothing to strip — so it could never fail.
   Every fixture below is a shape a REAL server emits. */
'use strict';
const A = require('./_assert.js');
const TS = require('../sidecar/providers/toolschema.js');
const { _internals: G } = require('../sidecar/providers/gemini.js');
const { _internals: AN } = require('../sidecar/providers/anthropic.js');

// Exactly what zod-to-json-schema (the official MCP TypeScript SDK's schema builder) emits.
const ZOD_SHAPE = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    state: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    per_page: { type: 'integer', default: 30, minimum: 1, maximum: 100 }
  },
  required: ['query']
};

const REJECTED = ['$schema', 'additionalProperties', 'oneOf', 'allOf', '$ref', 'const',
  'patternProperties', 'exclusiveMinimum', 'multipleOf', 'uniqueItems', 'not', '$defs', 'definitions'];

function findKeys(node, bad, path, hits) {
  if (!node || typeof node !== 'object') return hits;
  for (const k of Object.keys(node)) {
    if (bad.indexOf(k) >= 0) hits.push((path ? path + '.' : '') + k);
    findKeys(node[k], bad, (path ? path + '.' : '') + k, hits);
  }
  return hits;
}

(async () => {
  // A. THE BUG: no Gemini-rejected keyword survives forGemini().
  {
    const out = TS.forGemini(ZOD_SHAPE);
    A.eq(findKeys(out, REJECTED, '', []), [], 'no Gemini-rejected keyword survives');
    A.eq(out.type, 'object', 'root type kept');
    A.eq(out.properties.query, { type: 'string' }, 'plain property passes through untouched');
    A.eq(out.required, ['query'], 'required kept');
    A.eq(out.properties.per_page.minimum, 1, 'supported constraints (minimum) kept');
    A.ok(out.properties.per_page.default === undefined, 'advisory `default` pruned (late addition; custom baseUrls may predate it)');
  }

  // B. the null-union collapses to its real branch + nullable, rather than being dropped.
  {
    const out = TS.forGemini(ZOD_SHAPE);
    A.eq(out.properties.state, { type: 'string', nullable: true }, 'anyOf[X,null] -> X + nullable');
  }

  // C. $ref/$defs are inlined (zod emits these for any reused sub-schema).
  {
    const out = TS.forGemini({
      type: 'object',
      $defs: { Point: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } },
      properties: { at: { $ref: '#/$defs/Point', default: null } }
    });
    A.eq(out.properties.at.type, 'object', '$ref inlined to its target');
    A.eq(out.properties.at.properties.x, { type: 'number' }, 'inlined target keeps its properties');
    A.ok(out.$defs === undefined, '$defs bag dropped after inlining');
  }

  // D. a self-referential $ref degrades to a permissive node instead of hanging or throwing.
  {
    const out = TS.forGemini({
      type: 'object',
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
      properties: { head: { $ref: '#/$defs/Node' } }
    });
    A.eq(findKeys(out, REJECTED, '', []), [], 'cyclic $ref leaves no rejected keyword');
    A.ok(out.properties.head.properties.next.type === 'string', 'cycle degrades to a permissive node');
  }

  // E. shapes other generators emit: array type, const, oneOf, unknown keywords.
  {
    const out = TS.forGemini({
      type: 'object',
      properties: {
        mode: { const: 'fast' },
        who: { type: ['string', 'null'] },
        pick: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        odd: { type: 'string', multipleOf: 3, uniqueItems: true }
      }
    });
    A.eq(out.properties.mode, { type: 'string', enum: ['fast'] }, 'const -> single-member enum');
    A.eq(out.properties.who, { type: 'string', nullable: true }, 'type:[T,null] -> T + nullable');
    A.eq(out.properties.pick.anyOf.length, 2, 'a genuine oneOf becomes anyOf (Gemini supports anyOf)');
    A.eq(out.properties.odd, { type: 'string' }, 'unsupported constraints dropped, type kept');
  }

  // F. required naming a property that does not exist is an invalid schema; drop the phantom.
  {
    const out = TS.forGemini({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'ghost'] });
    A.eq(out.required, ['a'], 'phantom required entry filtered out');
  }

  // G. PURITY: the registry tool def is shared across runs and adapters, so a mutation here would
  // corrupt the next request on a different provider.
  {
    const before = JSON.stringify(ZOD_SHAPE);
    TS.forGemini(ZOD_SHAPE); TS.normalize(ZOD_SHAPE);
    A.eq(JSON.stringify(ZOD_SHAPE), before, 'input schema never mutated');
  }

  // H. malformed server output must degrade the one tool, never throw into the run.
  {
    A.notThrows(() => TS.forGemini({ type: 'object', properties: { bad: 'object' } }), 'string-valued sub-schema does not throw');
    A.eq(TS.forGemini({ type: 'object', properties: { bad: 'object' } }).properties.bad, { type: 'string' }, 'malformed node -> permissive');
    A.eq(TS.forGemini(null), { type: 'object', properties: {} }, 'null schema -> empty object schema');
  }

  // I. END-TO-END through the real Gemini wire builder — the seam that actually 400'd.
  {
    const decls = G.toGeminiTools([{ type: 'function', function: { name: 'mcp__github__search', description: 'd', parameters: ZOD_SHAPE } }]);
    const params = decls[0].functionDeclarations[0].parameters;
    A.eq(findKeys(params, REJECTED, '', []), [], 'wire payload carries no rejected keyword');
    A.eq(params.properties.state, { type: 'string', nullable: true }, 'wire payload has the collapsed union');
  }

  // J. a no-argument tool omits `parameters`: Gemini rejects OBJECT with an empty properties bag
  // ("should be non-empty for OBJECT type"). bridge-core and many MCP servers ship exactly this.
  {
    const decls = G.toGeminiTools([{ type: 'function', function: { name: 'ping', parameters: { type: 'object', properties: {} } } }]);
    A.ok(!('parameters' in decls[0].functionDeclarations[0]), 'no-arg tool omits parameters entirely');
    A.ok(TS.isEmptyObjectSchema({ type: 'object' }), 'bare object counts as empty');
    A.ok(!TS.isEmptyObjectSchema({ type: 'object', properties: { a: { type: 'string' } } }), 'object with a property is not empty');
  }

  // K. Anthropic gets normalize(), not the prune: it tolerates extra keywords but rejects a
  // null-union at the root of input_schema.
  {
    const tools = AN.toAnthropicTools([{ type: 'function', function: { name: 't', parameters: ZOD_SHAPE } }]);
    const s = tools[0].input_schema;
    A.eq(s.properties.state, { type: 'string', nullable: true }, 'anthropic wire collapses the null-union');
    A.eq(s.additionalProperties, false, 'anthropic KEEPS standard keywords it accepts');
  }

  A.report('provider.toolschema.test');
})().catch(e => { console.log('FAIL: provider.toolschema.test threw -- ' + (e && e.stack || e)); process.exit(1); });
