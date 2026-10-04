/* sidecar/runtimeinfo.js - safe, prompt-visible run identity.

   The host knows provider/model/run metadata, but the model only sees prompt text.
   This module exposes the harmless subset as a sanitized system-prompt block so
   the agent can answer basic operator questions without guessing. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).runtimeinfo = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function oneLine(v, fallback, max) {
    const s = (v == null ? '' : String(v))
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (s || fallback || 'unknown').slice(0, max || 120);
  }

  function listLine(values, maxItems) {
    const out = [];
    const seen = new Set();
    for (const v of Array.isArray(values) ? values : []) {
      const s = oneLine(v, '', 120);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= (maxItems || 6)) break;
    }
    return out;
  }

  function runtimeIdentityBlock(o) {
    o = o || {};
    const provider = oneLine(o.provider, 'unknown', 80);
    const model = oneLine(o.model, 'unknown', 160);
    const surface = oneLine(o.surface, 'interactive', 40);
    const trigger = oneLine(o.trigger, 'directive', 40);
    const agentId = oneLine(o.agentId, 'agent', 80);
    const runId = oneLine(o.runId, 'pending', 120);
    const harness = oneLine(o.harness, 'unknown', 80);
    const app = oneLine(o.app, 'unknown', 40);
    const fallbacks = listLine(o.fallbackModels, 6).filter(x => x !== model);
    const lines = [
      '[RUNTIME]',
      'StarNet app version at run start: ' + app,
      'StarNet harness build at run start: ' + harness,
      'Provider: ' + provider,
      'Requested model at run start: ' + model,
      'Agent id: ' + agentId,
      'Run id: ' + runId,
      'Surface: ' + surface,
      'Trigger: ' + trigger
    ];
    if (fallbacks.length) lines.push('Possible fallback models: ' + fallbacks.join(', '));
    lines.push('If the Commander asks what StarNet build, model, provider, run, surface, or session you are using, answer from this block. For mutable harness state such as scheduler health, routines, connectors, or errors, call station.inspect. Do not guess or invent a CLI command.');
    return '\n\n' + lines.join('\n');
  }

  return { oneLine, runtimeIdentityBlock };
});
