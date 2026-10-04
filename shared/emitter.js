/* shared/emitter.js — validate-then-emit. Drops + logs malformed payloads; NEVER throws.
   makeEmitter(bus, log) -> emit(name, payload) -> boolean (true iff it reached the bus).
     bus : { emit(name, payload) }   — e.g. frontend/js/util.js U.bus, or the test fake
     log : optional fn(entry)        — entry = { level, kind, event, errors?, payload?, message? }
   Malformed payloads never reach the bus, so frontend listeners only ever see valid data.
   Because U.bus.emit swallows handler throws, callers/tests must assert AFTER a run. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./events.js'));
  else { root.SK = root.SK || {}; root.SK.emitter = factory(root.SK.events); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (events) {
  'use strict';

  function makeEmitter(bus, log) {
    return function emit(name, payload) {
      let res;
      try { res = events.validate(name, payload); }
      catch (e) { res = { ok: false, errors: ['validate threw: ' + (e && e.message)] }; }

      if (!res.ok) {
        try { if (log) log({ level: 'warn', kind: 'invalid-event', event: name, errors: res.errors, payload }); } catch (_) {}
        return false;
      }
      try { bus.emit(name, payload); }
      catch (e) {
        try { if (log) log({ level: 'error', kind: 'emit-threw', event: name, message: e && e.message }); } catch (_) {}
        return false;
      }
      return true;
    };
  }

  return { makeEmitter };
});
