/* sidecar/skills/gate.js - WHO MAY READ a saved skill.

   skillstore.persist() has always scanned every skill through skills/guard.js and stamped the
   verdict on the record as `guardAction` ('allow' | 'ask' | 'block'). Nothing consumed it: a
   skill the scanner called dangerous was still indexed into the system prompt, still preloaded
   by /skill, and still returned in full by skill.view. This module is the consumer — the one
   place that answers "may the MODEL see this?".

   Three rules, and they are deliberately not symmetric:
     block -> never visible, and NOT approvable. `block` is the trust table's answer for content
              a TRUSTED source should never have written (skills/guard.js TRUST); a click cannot
              make it safe, and offering the click would just train the Commander to click.
     ask   -> withheld until the Commander approves THIS EXACT CONTENT. The approval is keyed to
              a content digest, mirroring plugins.js keying its allowlist to the code hash: an
              edit re-asks, exactly like a silently edited plugin re-asks.
     other -> visible.

   A withheld skill is still LISTED (name + reason, never its summary — the summary is
   model-authored text the scanner never covered). Hiding the row outright would make the model
   try to create a same-named skill, which manage() then refuses as a duplicate: a silent gate
   that manufactures a confusing refusal two turns later. Truthful telemetry applies to the
   prompt too — say the skill exists and say it is withheld.

   Pure and dependency-injected: `approvals` is a lookup the sidecar owns (a JSON file under
   WORKSPACES), `guard` is skills/guard.js. Nothing here touches the filesystem.
*/
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).skillGate = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTION_RANK = { allow: 0, '': 0, ask: 1, block: 2 };
  function str(v) { return v == null ? '' : String(v); }
  function rankOf(a) {
    const k = str(a).trim().toLowerCase();
    // Unknown action = worst, same law as guard.js worse(): an unrecognized verdict must never
    // be treated as the safer option.
    return Object.prototype.hasOwnProperty.call(ACTION_RANK, k) ? ACTION_RANK[k] : ACTION_RANK.block;
  }
  function worseAction(a, b) { return rankOf(a) >= rankOf(b) ? (str(a) || 'allow') : (str(b) || 'allow'); }
  function trustSource(createdBy) {
    const source = str(createdBy).trim().toLowerCase();
    if (source === 'user') return 'user';
    if (source === 'community' || source === 'skill-exchange') return 'community';
    if (source === 'builtin' || source === 'trusted') return source;
    return 'agent-created';
  }

  /* digestOf — a stable content fingerprint over everything the guard actually scans (body,
     setup, and every support file), so an approval is bound to the content that was reviewed.
     FNV-1a in pure JS on purpose: skillstore stamps this on every persist and the store must
     stay dependency-free (no crypto, no injected hash to forget in a test). Collision risk is
     irrelevant here — this is a change detector, not a signature. */
  function digestOf(skill) {
    const files = Array.isArray(skill && skill.files) ? skill.files.slice() : [];
    files.sort((a, b) => str(a && a.path).localeCompare(str(b && b.path)));
    let text = str(skill && skill.body) + '\x00' + str(skill && skill.setup);
    for (const f of files) text += '\x00' + str(f && f.path) + '\x00' + str(f && f.content);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i) & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      const hi = text.charCodeAt(i) >>> 8;
      if (hi) { h ^= hi; h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    }
    return ('00000000' + h.toString(16)).slice(-8) + '-' + text.length;
  }

  function categoriesOf(skill) {
    const scan = skill && skill.scan;
    const findings = (scan && Array.isArray(scan.findings)) ? scan.findings : [];
    const out = [];
    for (const f of findings) {
      // Report the CATEGORY, never the matched text: the match is attacker-authored content and
      // echoing it into a tool result would carry the injection straight back into the prompt.
      const c = str(f && f.category);
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }

  function makeSkillGate(deps) {
    deps = deps || {};
    const guard = deps.guard || null;
    const approvals = deps.approvals || null;

    function keyFor(agentId, id) { return str(agentId || 'agent') + '\x00' + str(id); }
    function approvalFor(skill) {
      if (!approvals || typeof approvals.get !== 'function' || !skill) return null;
      try { return approvals.get(str(skill.agentId || 'agent'), str(skill.id)) || null; } catch (_) { return null; }
    }
    /* A stamped digest is what list() can carry (metadata only — no body). When the store had no
       digest stamper, fall back to the lifecycle stamp so an approval still expires on the next
       real mutation rather than never expiring. */
    function stampOf(skill) {
      const d = str(skill && skill.contentDigest);
      return d || ('u' + str((skill && skill.updatedAt) || 0));
    }
    function isApproved(skill) {
      const rec = approvalFor(skill);
      return !!(rec && str(rec.digest) === stampOf(skill));
    }

    /* decide — the metadata-only decision, safe to call from the index composer where bodies are
       not loaded. `action` is the guard verdict already stamped on the record by persist(). */
    function decide(skill) {
      const action = str(skill && skill.guardAction).trim().toLowerCase();
      if (action === 'block') {
        return { action: 'block', visible: false, approvable: false, categories: categoriesOf(skill),
          reason: 'blocked by the skill guard' };
      }
      if (action === 'ask') {
        if (isApproved(skill)) return { action: 'ask', visible: true, approvable: true, approved: true, categories: categoriesOf(skill), reason: 'approved by the Commander' };
        return { action: 'ask', visible: false, approvable: true, approved: false, categories: categoriesOf(skill),
          reason: 'needs the Commander\'s approval in ABILITIES > SKILLS' };
      }
      return { action: action || 'allow', visible: true, approvable: false, categories: [], reason: '' };
    }

    /* verify — the DELIVERY decision, for the one path that hands over a real body (skill.view /
       preload). package.js hydrate() reads SKILL.md back off disk and OVERRIDES the stored body,
       so the bytes delivered here are not necessarily the bytes persist() scanned: someone who
       can write into the package dir could otherwise launder content past the scanner. Recompute
       the digest, and on a mismatch re-scan LIVE and take the worse of the two actions. */
    function liveScan(skill) {
      try {
        if (!guard || typeof guard.scanSkillRecord !== 'function' || typeof guard.shouldAllow !== 'function') return null;
        const scan = guard.scanSkillRecord(skill, { source: trustSource(skill.createdBy) });
        const policy = guard.shouldAllow(scan, { allowAsk: true });
        return { action: (policy && policy.action) || 'allow', scan };
      } catch (_) { return null; }
    }
    function verify(skill) {
      const base = decide(skill);
      const stamped = str(skill && skill.contentDigest);
      if (!skill || typeof skill.body !== 'string') return base;
      /* A LEGACY RECORD CARRIES NO VERDICT AND NO DIGEST. skills.jsonl predates both the scanner
         and this gate, so an old skill would otherwise sail through with guardAction '' — the
         quietest possible hole, because it looks exactly like a clean skill. Nothing can scan it
         from metadata alone (list() has no body), so the delivery seam scans it here, where the
         body finally exists. The index may still name it; only the bytes are gated. */
      if (!stamped && !str(skill.guardAction)) {
        const live = liveScan(skill);
        if (!live || live.action === 'allow') return base;
        const legacy = decide(Object.assign({}, skill, { guardAction: live.action, scan: live.scan }));
        legacy.unscanned = true;
        if (!legacy.visible) legacy.reason = 'this skill was saved before the guard existed and re-scanning it flagged content — review it in ABILITIES > SKILLS';
        return legacy;
      }
      if (!stamped) return base;
      if (digestOf(skill) === stamped) return base;
      const live = liveScan(skill);
      const action = worseAction(base.action, live ? live.action : 'ask');   // unscannable tamper => at least ask
      /* Re-decide against the LIVE digest, never the stamped one. decide()'s 'ask' branch calls
         isApproved(), which compares the approval record to stampOf(skill) === skill.contentDigest — the
         digest written at PERSIST time, which a write into the package dir never moves. Handing decide()
         the stale stamp here let a prior approval clear the very tamper this branch just proved it does
         not cover, and the live re-scan can never save it: liveScan passes source 'user'/'agent-created'
         and both TRUST rows map dangerous -> 'ask', never 'block', so worseAction('ask','ask') is 'ask'
         and the approved branch made it visible. That laundered whatever is now in SKILL.md into the
         model on the one seam that hands over a real body. */
      const merged = decide(Object.assign({}, skill, {
        guardAction: action, scan: (live && live.scan) || skill.scan, contentDigest: digestOf(skill)
      }));
      merged.tampered = true;
      merged.approved = false;   // an approval of other bytes is not an approval of these
      merged.reason = merged.visible ? merged.reason
        : (merged.action === 'block' ? 'the package on disk no longer matches what was reviewed, and re-scanning it blocked'
          : 'the package on disk was changed after it was reviewed — re-approve it in ABILITIES > SKILLS');
      return merged;
    }

    /* annotate — stamp the decision onto a metadata list without mutating the input. Consumers
       (prompt index, skill.list, the SKILLS panel) all read the same fields.

       With { verify: true } AND a body present, the DELIVERY decision is used instead of the
       metadata-only one. decide() cannot re-digest, so a caller that holds real bytes would otherwise
       keep printing "Approved by you for this exact content" about a package whose SKILL.md no longer
       matches what was reviewed — the panel asserting a content binding the backend does not hold.
       Callers with metadata only (the prompt index, skill.list) get decide() exactly as before. */
    function annotate(skills, opts) {
      const useVerify = !!(opts && opts.verify);
      return (Array.isArray(skills) ? skills : []).map(s => {
        const d = (useVerify && s && typeof s.body === 'string') ? verify(s) : decide(s);
        return Object.assign({}, s, {
          withheld: !d.visible, withheldReason: d.visible ? '' : d.reason,
          guardDecision: d.action, guardApprovable: !!d.approvable, guardCategories: d.categories,
          guardTampered: !!d.tampered
        });
      });
    }
    function pending(skills) {
      return annotate(skills).filter(s => s.withheld && s.guardApprovable)
        .map(s => ({ id: s.id, agentId: s.agentId, name: s.name, action: s.guardDecision, categories: s.guardCategories, digest: stampOf(s) }));
    }

    return { decide, verify, annotate, pending, keyFor, stampOf, isApproved, digestOf };
  }

  return { makeSkillGate, digestOf, worseAction };
});
