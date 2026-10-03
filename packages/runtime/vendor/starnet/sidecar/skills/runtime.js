/* sidecar/skills/runtime.js - prompt index for runtime-created agent skills.

   Bundled recipes inject full bodies because they are curated and capability
   gated. Agent-created skills use progressive disclosure: every run sees the
   compact index, and the model must call skill.view when a listed skill is
   even partly relevant.
*/
'use strict';
(function (root, factory) {
  // context.js supplies the ONE lexical scorer (bm25) so the skill index ranks by the same brain memory
  // recall uses — never a second drifting copy of the algorithm. Node requires it; the (vestigial) browser
  // path picks it off root.SK, degrading to unordered if absent — composeIndex guards for that.
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('../context.js'));
  else { (root.SK = root.SK || {}).runtimeSkills = factory((root.SK || {}).context); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (context) {
  'use strict';

  function str(v) { return v == null ? '' : String(v); }
  function platformOk(s, platform) {
    const ps = Array.isArray(s && s.platforms) ? s.platforms.map(x => str(x).toLowerCase()) : [];
    if (!ps.length || !platform) return true;
    const p = str(platform).toLowerCase();
    return ps.indexOf(p) >= 0 || (p === 'win32' && ps.indexOf('windows') >= 0) || (p === 'darwin' && ps.indexOf('macos') >= 0);
  }
  function isLive(s, platform) { return s && s.state !== 'archived' && platformOk(s, platform); }
  function cleanLine(s) { return str(s).replace(/\s+/g, ' ').trim(); }

  /* gateOf — the guard decision for one skill, from an injected gate (skills/gate.js). No gate
     injected = everything visible, which is exactly how this file behaved before the gate existed. */
  function gateOf(s, gate) {
    if (typeof gate !== 'function') return { visible: true, reason: '' };
    try { const d = gate(s) || {}; return { visible: d.visible !== false, reason: str(d.reason) }; }
    catch (_) { return { visible: true, reason: '' };  /* a gate hiccup must never empty the index */ }
  }

  /* RELEVANCE-ORDERED INDEX: with opts.query, the index leads with the skills lexically relevant to THIS ask —
     under the 6000-char budget the relevant skill must never be the one skipped for a stale-but-recent one.
     Pinned skills keep the existing contract (always first, in caller order). The rest sort by context.js's
     bm25 over {name, summary} (skills shim onto the record shape as title/body), tiebreak updatedAt desc then
     name then caller order — the caller (skillStore mine()) already sorts that way, so a no-overlap query
     degrades to today's order. No query at all (or no scorer in the vestigial browser path) → exactly the
     caller's order, byte-identical to before. Nothing is ever DROPPED by relevance: the budget's own
     skip-and-count is the only omission path, unchanged. */
  function orderByQuery(live, query, ctx) {
    if (!query || !ctx || typeof ctx.bm25 !== 'function') return live;
    const rel = ctx.bm25(live.map(s => ({ kind: 'note', title: str(s && s.name), body: str(s && s.summary) })), query);
    if (!rel.queried) return live;   // no significant tokens (image-only turn) -> today's order
    const rows = live.map((s, i) => ({ s: s, i: i, score: rel.scores[i] || 0 }));
    const cmp = (a, b) => (b.score - a.score)
      || (((b.s && b.s.updatedAt) || 0) - ((a.s && a.s.updatedAt) || 0))
      || str(a.s && a.s.name).localeCompare(str(b.s && b.s.name))
      || (a.i - b.i);
    const pinned = rows.filter(x => x.s && x.s.pinned);
    const rest = rows.filter(x => !(x.s && x.s.pinned)).sort(cmp);
    return pinned.concat(rest).map(x => x.s);
  }

  function composeIndex(skills, opts) {
    opts = opts || {};
    const budget = opts.budget > 0 ? opts.budget : 6000;
    const live = (Array.isArray(skills) ? skills : []).filter(s => isLive(s, opts.platform));
    if (!live.length) return { text: '', ids: [], omitted: 0, withheld: 0 };
    const ordered = orderByQuery(live, opts.query == null ? '' : String(opts.query), context);

    const canManage = opts.canManage !== false;
    const parts = [];
    const ids = [];
    let used = 0, omitted = 0, withheld = 0;
    for (const s of ordered) {
      const bits = [];
      bits.push('- ' + cleanLine(s.name || s.id || 'Skill'));
      /* A WITHHELD SKILL IS NAMED, NEVER SUMMARIZED, AND NEVER PROMISED. The row exists so the
         model doesn't try to create a duplicate of a skill it cannot see; the summary is dropped
         because it is model-authored text the guard's scan never covered, and the id is dropped
         from `ids` so it is not counted as used — nothing was delivered. */
      const g = gateOf(s, opts.gate);
      if (!g.visible) {
        withheld++;
        const line = bits[0] + ' [WITHHELD: ' + cleanLine(g.reason || 'held by the skill guard') + ' - do not recreate it]';
        if (parts.length && used + line.length > budget) { omitted++; continue; }
        parts.push(line); used += line.length;
        continue;
      }
      if (s.summary) bits.push(' -- ' + cleanLine(s.summary));
      const meta = [];
      if (s.category) meta.push(cleanLine(s.category));
      if (s.state && s.state !== 'active') meta.push(cleanLine(s.state));
      if (s.pinned) meta.push('pinned');
      if (s.platforms && s.platforms.length) meta.push('platforms: ' + s.platforms.join('/'));
      if (s.files && s.files.length) meta.push(String(s.files.length) + ' support file' + (s.files.length === 1 ? '' : 's'));
      if (meta.length) bits.push(' [' + meta.join(', ') + ']');
      if (s.id) bits.push(' (id: ' + cleanLine(s.id) + ')');
      const line = bits.join('');
      if (parts.length && used + line.length > budget) { omitted++; continue; }
      parts.push(line); used += line.length; if (s.id) ids.push(s.id);
    }
    if (!parts.length) return { text: '', ids: [], omitted: live.length, withheld };

    const manage = canManage
      ? 'If the task teaches a reusable procedure, update an existing skill or create a new one with skill.manage.'
      : 'If the task teaches a reusable procedure, save it with skill.write.';
    const head = '\n\n## SAVED AGENT SKILLS (mandatory)\n'
      + 'Before replying, scan this skill index. If any saved skill is even partly relevant, call skill.view with its name before acting. '
      + 'Do not infer the procedure from the summary alone; load the full body first. ' + manage + '\n\n';
    const tail = omitted ? ('\n\n(' + omitted + ' more saved skill' + (omitted === 1 ? ' was' : 's were') + ' omitted to keep the prompt lean.)') : '';
    return { text: head + parts.join('\n') + tail, ids, omitted, withheld };
  }

  function extractInvocations(messages) {
    const out = [];
    for (const m of (Array.isArray(messages) ? messages : [])) {
      if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
      for (const line of m.content.split(/\r?\n/)) {
        let mm = line.match(/^\s*\/skill\s+(.+?)\s*$/i);
        if (mm) { out.push(mm[1].trim()); continue; }
        mm = line.match(/^\s*\/skill-([A-Za-z0-9._ -]{1,80})\s*$/i);
        if (mm) out.push(mm[1].trim().replace(/-/g, ' '));
      }
    }
    return out.filter(Boolean);
  }

  /* composeLoaded injects FULL BODIES for skills the Commander named (/skill, preloadSkills), so
     the gate matters here even more than in the index. The caller already filters, and `withheld`
     is checked again here: this is the last seam before the bytes enter the system prompt. */
  function composeLoaded(skills) {
    const live = (Array.isArray(skills) ? skills : []).filter(s => s && s.body && s.state !== 'archived' && !s.withheld);
    if (!live.length) return '';
    return '\n\n## PRELOADED SKILLS\n'
      + 'The Commander explicitly loaded these skills for this run. Follow them where applicable.\n\n'
      + live.map(s => '### ' + cleanLine(s.name || s.id || 'Skill') + (s.summary ? ' -- ' + cleanLine(s.summary) : '') + '\n'
        + (s.setup ? 'Setup:\n' + s.setup + '\n\n' : '') + s.body
        + (s.files && s.files.length ? '\n\nSupport files:\n' + s.files.map(f => '- ' + f.path + (f.content ? '\n' + f.content : '')).join('\n') : '')
      ).join('\n\n');
  }

  return { composeIndex, extractInvocations, composeLoaded };
});
