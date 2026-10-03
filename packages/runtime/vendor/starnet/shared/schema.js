/* shared/schema.js — zero-dep JSON-schema-lite validator (tool args + event payloads).
   Pure: no ambient globals. validate(schema, value) -> { ok:boolean, errors:string[] }.

   Supported constructs: type (string | string[]; 'string'|'number'|'integer'|'boolean'|
   'object'|'array'|'null'), enum, properties + required (objects), items (arrays),
   additionalProperties:false. A missing/empty schema imposes no constraint. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).schema = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function typeOf(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function matchesType(ty, value) {
    const t = typeOf(value);
    if (ty === 'integer') return t === 'number' && Number.isInteger(value);
    if (ty === 'number') return t === 'number' && Number.isFinite(value);
    return ty === t;
  }

  function check(schema, value, path, errors) {
    if (!schema || typeof schema !== 'object') return; // no constraint
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some(ty => matchesType(ty, value))) {
        errors.push(path + ': expected ' + types.join('|') + ', got ' + typeOf(value));
        return; // type mismatch — deeper checks are meaningless
      }
    }
    if (schema.enum !== undefined && !schema.enum.some(e => e === value)) {
      errors.push(path + ': ' + JSON.stringify(value) + ' not in enum');
    }
    const t = typeOf(value);
    if (t === 'object') {
      // OWN properties only. The `in` operator walks the PROTOTYPE CHAIN, so every Object.prototype key was
      // treated as present/declared: {q:'x', toString:1} passed additionalProperties:false, and a required
      // 'constructor' was satisfied by a property nobody supplied. Third-party MCP inputSchemas reach this
      // validator verbatim, so the tightening matters beyond the built-ins. hasOwnProperty is called off
      // Object.prototype so a payload carrying its own `hasOwnProperty` key can't shadow the check.
      const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      if (Array.isArray(schema.required)) {
        for (const k of schema.required) {
          if (!has(value, k) || value[k] === undefined) errors.push(path + '.' + k + ': required');
        }
      }
      if (schema.properties) {
        for (const k of Object.keys(schema.properties)) {
          if (has(value, k) && value[k] !== undefined) check(schema.properties[k], value[k], path + '.' + k, errors);
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        for (const k of Object.keys(value)) if (!has(schema.properties, k)) errors.push(path + '.' + k + ': additional property not allowed');
      }
    }
    if (t === 'array' && schema.items) {
      for (let i = 0; i < value.length; i++) check(schema.items, value[i], path + '[' + i + ']', errors);
    }
  }

  function validate(schema, value) {
    const errors = [];
    check(schema, value, '$', errors);
    return { ok: errors.length === 0, errors };
  }

  return { validate, typeOf };
});
