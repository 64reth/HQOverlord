/* sidecar/skillstore.js - the agent's owned, reusable SKILL library.

   Runtime skills are per-agent procedure documents. list() is metadata-only,
   view() loads the body on demand, and manage() owns the lifecycle so the
   agent can create, patch, archive, restore, pin, and attach support files
   without reaching into its own storage through fs tools.

     makeSkillStore({ io, clock, redact?, maxPerAgent?, bodyMax? }) -> {
       write({ agentId, name, summary, body }) -> legacy create/edit wrapper,
       manage({ agentId, action, ... }) -> lifecycle operation,
       list(agentId, opts?) -> metadata only,
       view(agentId, idOrName, opts?) -> full body/support files,
       markUsed(agentId, idOrNames) -> usage telemetry,
       curate(agentId, opts?) -> stale/archive lifecycle pass,
       all(), count()
     } */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).skillstore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // failopen.note — the tagged SYNC swallow (per-tag count + throttled warn): a fail-open catch must never be invisible.
  const { note: failNote } = (typeof require === 'function') ? require('./failopen.js') : { note: function (tag, e) { console.warn('[failopen] ' + tag + ':', (e && e.message) || e); } };

  // Open Agent Skills recommend keeping SKILL.md lean, but real production procedures commonly exceed
  // 20k characters. Truncating one while retaining its upstream digest made provenance lie: "up to date"
  // could describe a locally chopped document. Match the package byte ceiling so accepted source bytes
  // round-trip intact; progressive disclosure still keeps bodies out of the always-on prompt index.
  const NAME_MAX = 80, SUMMARY_MAX = 280, CATEGORY_MAX = 80, BODY_MAX = 256000;
  const DEFAULT_MAX_PER_AGENT = 100, SUPPORT_FILE_MAX = 256000;
  // A package is bounded by three numbers, not one. Per-file content was always clamped
  // (SUPPORT_FILE_MAX), but nothing bounded HOW MANY files or the package total — so a review
  // pass that keeps demoting session detail into references/ could grow one skill without limit.
  const DEFAULT_MAX_FILES = 64, DEFAULT_MAX_PACKAGE_BYTES = 1024 * 1024;
  // Sets, not object literals: `({a:1})['constructor']` is truthy, so an object-literal allowlist
  // silently admits every Object.prototype key — and these keys come off persisted/model-supplied data.
  const STATES = new Set(['active', 'stale', 'archived']);
  const ALLOWED_SUPPORT_DIRS = ['references', 'templates', 'scripts', 'assets'];

  function str(v) { return v == null ? '' : String(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function bool(v) { return !!v; }
  function slug(name) {
    return str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'skill';
  }
  const keyOf = (agentId, name) => str(agentId) + '\x00' + str(name).trim().toLowerCase();

  function clone(o) { return JSON.parse(JSON.stringify(o == null ? null : o)); }
  function arr(v) {
    if (Array.isArray(v)) return v.map(x => str(x).trim()).filter(Boolean);
    if (v == null || v === '') return [];
    return [str(v).trim()].filter(Boolean);
  }
  function stateOf(v) {
    const s = str(v || 'active').toLowerCase();
    return STATES.has(s) ? s : 'active';
  }
  const REVIEW_ACTORS = new Set(['background-review', 'skill-review']);   // autonomous writers whose versions must be approved (the 24h curator is deliberately NOT here: it archives narrow siblings into a widened umbrella, and withholding the umbrella would leave the Commander with neither until they clicked)
  function trustSource(createdBy) {
    const source = str(createdBy).trim().toLowerCase();
    if (source === 'user') return 'user';
    if (source === 'community' || source === 'skill-exchange') return 'community';
    if (source === 'builtin' || source === 'trusted') return source;
    return 'agent-created';
  }
  function cleanName(v) {
    const name = str(v).trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    if (!name) return { ok: false, error: 'a skill needs a name' };
    if (/[\x00-\x1F<>:"|?*\\/]/.test(name)) return { ok: false, error: 'skill name contains unsafe characters' };
    return { ok: true, name };
  }
  function cleanCategory(v) {
    const c = str(v || 'General').trim().replace(/\s+/g, ' ').slice(0, CATEGORY_MAX);
    return c || 'General';
  }
  function normFiles(files) {
    const out = {};
    if (!files) return out;
    if (Array.isArray(files)) {
      for (const f of files) if (f && f.path) out[str(f.path)] = {
        path: str(f.path), content: str(f.content).slice(0, Math.ceil(SUPPORT_FILE_MAX * 4 / 3) + 4),
        encoding: f.encoding === 'base64' ? 'base64' : 'utf8', updatedAt: num(f.updatedAt)
      };
      return out;
    }
    if (typeof files === 'object') {
      for (const p of Object.keys(files)) {
        const f = files[p];
        if (f && typeof f === 'object') out[str(f.path || p)] = {
          path: str(f.path || p), content: str(f.content).slice(0, Math.ceil(SUPPORT_FILE_MAX * 4 / 3) + 4),
          encoding: f.encoding === 'base64' ? 'base64' : 'utf8', updatedAt: num(f.updatedAt)
        };
        else out[str(p)] = { path: str(p), content: str(f).slice(0, SUPPORT_FILE_MAX), encoding: 'utf8', updatedAt: 0 };
      }
    }
    return out;
  }
  function normPackageFiles(files) {
    if (!Array.isArray(files)) return [];
    return files.map(f => ({
      path: str(f && f.path), encoding: 'base64', content: str(f && f.content),
      bytes: num(f && f.bytes), sha256: str(f && f.sha256)
    })).filter(f => f.path && f.content);
  }
  function supportPath(raw) {
    let p = str(raw).trim().replace(/\\/g, '/').replace(/^\/+/, '');
    p = p.replace(/\/+/g, '/');
    if (!p) return { ok: false, error: 'support file path required' };
    if (/^[A-Za-z]:/.test(p) || p.indexOf('..') >= 0 || /[\x00-\x1F]/.test(p)) return { ok: false, error: 'unsafe support file path' };
    const root = p.split('/')[0];
    if (ALLOWED_SUPPORT_DIRS.indexOf(root) < 0 || p === root) {
      return { ok: false, error: 'support files must live under ' + ALLOWED_SUPPORT_DIRS.join(', ') };
    }
    if (p.length > 180) return { ok: false, error: 'support file path is too long' };
    return { ok: true, path: p };
  }

  function normalizeEntry(r) {
    r = r || {};
    const n = cleanName(r.name);
    if (!n.ok) return null;
    const updatedAt = num(r.updatedAt) || num(r.createdAt);
    return {
      id: str(r.id || slug(n.name)),
      agentId: str(r.agentId) || 'agent',
      name: n.name,
      summary: str(r.summary).slice(0, SUMMARY_MAX),
      description: str(r.description || r.summary).slice(0, SUMMARY_MAX),
      body: str(r.body).slice(0, BODY_MAX),
      setup: str(r.setup).slice(0, BODY_MAX),
      category: cleanCategory(r.category),
      requires: arr(r.requires),
      platforms: arr(r.platforms),
      state: stateOf(r.state),
      pinned: bool(r.pinned),
      createdBy: str(r.createdBy || 'agent'),
      writtenBy: str(r.writtenBy || r.createdBy || 'agent'),   // who wrote THIS version (consistency loop: review writes ask)
      sourceRunId: r.sourceRunId ? str(r.sourceRunId) : null,
      sourceUrl: r.sourceUrl ? str(r.sourceUrl) : '',
      sourceDigest: r.sourceDigest ? str(r.sourceDigest) : '',
      sourceFetchedAt: num(r.sourceFetchedAt),
      sourceVersion: r.sourceVersion ? str(r.sourceVersion) : '',
      sourceAuthor: r.sourceAuthor ? str(r.sourceAuthor) : '',
      sourceLicense: r.sourceLicense ? str(r.sourceLicense) : '',
      createdAt: num(r.createdAt) || updatedAt,
      updatedAt: updatedAt,
      lastUsedAt: r.lastUsedAt == null ? null : num(r.lastUsedAt),
      viewCount: num(r.viewCount),
      useCount: num(r.useCount),
      patchCount: num(r.patchCount),
      packagePath: r.packagePath ? str(r.packagePath) : '',
      scan: r.scan || null,
      guardAction: r.guardAction || '',
      contentDigest: r.contentDigest ? str(r.contentDigest) : '',
      packageDigest: r.packageDigest ? str(r.packageDigest) : '',
      packageBytes: num(r.packageBytes),
      packageFiles: normPackageFiles(r.packageFiles),
      packageDiverged: bool(r.packageDiverged),
      absorbedInto: r.absorbedInto ? str(r.absorbedInto) : '',
      files: normFiles(r.files)
    };
  }

  function projectFile(f, includeContent) {
    const bytes = f.encoding === 'base64' ? Math.floor(str(f.content).length * 3 / 4) : Buffer.byteLength(str(f.content), 'utf8');
    const out = { path: f.path, encoding: f.encoding || 'utf8', updatedAt: num(f.updatedAt), bytes };
    if (includeContent) out.content = str(f.content);
    return out;
  }
  function projectSkill(s, includeBody) {
    const files = Object.keys(s.files || {}).sort().map(p => projectFile(s.files[p], !!includeBody));
    const out = {
      id: s.id, agentId: s.agentId, name: s.name, summary: s.summary, description: s.description || s.summary || '',
      category: s.category, setup: s.setup || '',
      requires: (s.requires || []).slice(), platforms: (s.platforms || []).slice(), state: s.state, pinned: !!s.pinned,
      createdBy: s.createdBy, writtenBy: s.writtenBy || s.createdBy, sourceRunId: s.sourceRunId || null,
      sourceUrl: s.sourceUrl || '', sourceDigest: s.sourceDigest || '', sourceFetchedAt: s.sourceFetchedAt || 0,
      sourceVersion: s.sourceVersion || '', sourceAuthor: s.sourceAuthor || '', sourceLicense: s.sourceLicense || '',
      createdAt: s.createdAt || 0, updatedAt: s.updatedAt || 0, lastUsedAt: s.lastUsedAt || null,
      viewCount: s.viewCount || 0, useCount: s.useCount || 0, patchCount: s.patchCount || 0,
      packagePath: s.packagePath || '', scan: s.scan || null, guardAction: s.guardAction || '',
      contentDigest: s.contentDigest || '', absorbedInto: s.absorbedInto || '',
      packageDigest: s.packageDigest || '', packageBytes: s.packageBytes || 0,
      packageFileCount: (s.packageFiles || []).length, packageDiverged: !!s.packageDiverged,
      files
    };
    if (includeBody) { out.body = s.body || ''; out.packageFiles = normPackageFiles(s.packageFiles); }
    return out;
  }

  function makeSkillStore(opts) {
    opts = opts || {};
    const io = opts.io || { readAll() { return []; }, append() {} };
    const clock = opts.clock || { now() { return 0; } };
    const redact = typeof opts.redact === 'function' ? opts.redact : (s) => s;
    const maxPerAgent = opts.maxPerAgent || DEFAULT_MAX_PER_AGENT;
    const bodyMax = opts.bodyMax || BODY_MAX;
    const supportFileMax = opts.supportFileMax || SUPPORT_FILE_MAX;
    const packageStore = opts.packageStore || opts.packages || null;
    const guard = opts.guard || null;
    // skills/gate.js digestOf, injected. The stamp is what lets the metadata-only list() answer
    // "is this exact content still the content the Commander approved?" without loading bodies.
    const digest = typeof opts.digest === 'function' ? opts.digest : null;
    const maxFiles = opts.maxFiles > 0 ? opts.maxFiles : DEFAULT_MAX_FILES;
    const maxPackageBytes = opts.maxPackageBytes > 0 ? opts.maxPackageBytes : DEFAULT_MAX_PACKAGE_BYTES;

    const latest = new Map();
    try {
      const raw = io.readAll();
      if (Array.isArray(raw)) for (const r of raw) {
        const n = normalizeEntry(r);
        if (n) latest.set(keyOf(n.agentId, n.name), n);
      }
    } catch (e) { /* corrupt log -> empty library (fail-open) */ }

    function now() { return num(clock.now()); }
    function red(s, max) {
      let v = str(s).slice(0, max);
      try { v = str(redact(v)).slice(0, max); } catch (e) { failNote('skillstore.redact', e); }
      return v;
    }
    // RAM-only bump: update the in-memory `latest` copy WITHOUT appending a JSONL line. view() is called on
    // every skill.view / skill load, many times per run — appending each one is what grows skills.jsonl without
    // bound. The bumped counters (viewCount/useCount/lastUsedAt/state) instead ride along the NEXT real mutation
    // (write/edit/patch/markUsed/curate all persist the skill, and makeEntry carries viewCount/useCount forward),
    // or a low-frequency compaction flush. Returns the projected skill (same shape view() returned before).
    function bumpView(entry) {
      latest.set(keyOf(entry.agentId, entry.name), clone(entry));
      return entry;
    }
    function persist(entry) {
      const projected = projectSkill(entry, true);
      try {
        if (guard && typeof guard.scanSkillRecord === 'function') {
          // 'user' (the Commander's own typing) is its own trust tier — see the TRUST table in
          // skills/guard.js for why it asks rather than blocks now that verdicts are enforced.
          const scanInput = clone(projected);
          if (Array.isArray(entry.packageFiles) && entry.packageFiles.length && !entry.packageDiverged) {
            scanInput.files = entry.packageFiles.filter(f => f.path !== 'SKILL.md').map(f => {
              const bytes = Buffer.from(str(f.content), 'base64'); const text = bytes.toString('utf8');
              return { path: f.path, content: Buffer.from(text, 'utf8').equals(bytes) ? text : '[binary asset: ' + bytes.length + ' bytes]' };
            });
          }
          const scan = guard.scanSkillRecord(scanInput, { source: trustSource(entry.createdBy) });
          entry.scan = scan;
          if (guard && typeof guard.shouldAllow === 'function') {
            const policy = guard.shouldAllow(scan, { allowAsk: true });
            entry.guardAction = policy.action || '';
          }
          /* PROVENANCE ASK (consistency loop, slice 3, 2026-08-22): a version written by the BACKGROUND REVIEW
             (the quiet aux loop that patches/creates skills after a run or a verdict) is withheld from every
             prompt until the Commander approves THESE bytes — the same digest-keyed gate a scanner `ask` uses
             and the same keep/discard the memory turn-in card has always had. Memory proposals were reviewed;
             skill writes landed straight into the next run's system prompt. A `block` stays a block. */
          if (REVIEW_ACTORS.has(str(entry.writtenBy)) && entry.guardAction !== 'block') entry.guardAction = 'ask';
        }
      } catch (e) { failNote('skillstore.guard.scan', e); }
      // Stamp the digest of the content that was JUST scanned, so the verdict and the digest can
      // never disagree about which bytes they describe.
      try { if (digest) entry.contentDigest = str(digest(projected)); } catch (_) {}
      try {
        if (packageStore && typeof packageStore.writePackage === 'function') {
          const dir = packageStore.writePackage(projectSkill(entry, true));
          if (dir) entry.packagePath = dir;
        }
      } catch (e) { failNote('skillstore.package.write', e); }
      try { io.append(clone(entry)); }
      catch (e) { failNote('skillstore.append', e); throw e; }
      // Publish to RAM only after the durable event was accepted. Otherwise manage() reports
      // success for a skill that vanishes on the next sidecar restart.
      latest.set(keyOf(entry.agentId, entry.name), clone(entry));
      return entry;
    }
    function mine(agentId, opts2) {
      opts2 = opts2 || {};
      const out = [];
      const pfx = str(agentId) + '\x00';
      for (const [k, v] of latest) {
        if (k.indexOf(pfx) !== 0) continue;
        if (!opts2.includeArchived && v.state === 'archived') continue;
        if (Array.isArray(opts2.states) && opts2.states.indexOf(v.state) < 0) continue;
        out.push(v);
      }
      out.sort((a, b) => (!!b.pinned - !!a.pinned) || ((b.updatedAt || 0) - (a.updatedAt || 0)) || a.name.localeCompare(b.name));
      return out;
    }
    function countFor(agentId) { return mine(agentId).length; }
    function find(agentId, idOrName, opts2) {
      opts2 = opts2 || {};
      const q = str(idOrName).trim();
      if (!q) return null;
      const byName = latest.get(keyOf(agentId, q));
      if (byName && (opts2.includeArchived || byName.state !== 'archived')) return byName;
      const ql = q.toLowerCase();
      for (const s of mine(agentId, { includeArchived: !!opts2.includeArchived })) {
        if (s.id === q || s.name.toLowerCase() === ql) return s;
      }
      return null;
    }

    function makeEntry(e, existing) {
      e = e || {};
      const n = cleanName(e.name != null ? e.name : (existing && existing.name));
      if (!n.ok) return n;
      const t = now();
      const body = e.body != null ? red(e.body, bodyMax) : (existing ? existing.body : '');
      return { ok: true, entry: {
        id: existing ? existing.id : slug(n.name),
        agentId: str(e.agentId || (existing && existing.agentId) || 'agent'),
        name: n.name,
        summary: e.summary != null ? red(e.summary, SUMMARY_MAX) : (existing ? existing.summary : ''),
        description: e.description != null ? red(e.description, SUMMARY_MAX) : (existing ? (existing.description || existing.summary) : red(e.summary, SUMMARY_MAX)),
        body,
        setup: e.setup != null ? red(e.setup, bodyMax) : (existing ? existing.setup || '' : ''),
        category: cleanCategory(e.category != null ? e.category : (existing && existing.category)),
        requires: e.requires != null ? arr(e.requires) : (existing ? (existing.requires || []).slice() : []),
        platforms: e.platforms != null ? arr(e.platforms) : (existing ? (existing.platforms || []).slice() : []),
        state: stateOf(e.state || (existing && existing.state) || 'active'),
        pinned: e.pinned != null ? !!e.pinned : !!(existing && existing.pinned),
        createdBy: str(e.createdBy || (existing && existing.createdBy) || 'agent'),
        writtenBy: str(e.createdBy || 'agent'),   // the actor of THIS write, never inherited (a review edit of a user skill is a review write)
        sourceRunId: e.sourceRunId ? str(e.sourceRunId) : ((existing && existing.sourceRunId) || null),
        sourceUrl: e.sourceUrl != null ? str(e.sourceUrl) : ((existing && existing.sourceUrl) || ''),
        sourceDigest: e.sourceDigest != null ? str(e.sourceDigest) : ((existing && existing.sourceDigest) || ''),
        sourceFetchedAt: e.sourceFetchedAt != null ? num(e.sourceFetchedAt) : ((existing && existing.sourceFetchedAt) || 0),
        sourceVersion: e.sourceVersion != null ? str(e.sourceVersion) : ((existing && existing.sourceVersion) || ''),
        sourceAuthor: e.sourceAuthor != null ? str(e.sourceAuthor) : ((existing && existing.sourceAuthor) || ''),
        sourceLicense: e.sourceLicense != null ? str(e.sourceLicense) : ((existing && existing.sourceLicense) || ''),
        createdAt: existing ? existing.createdAt : t,
        updatedAt: t,
        lastUsedAt: existing ? existing.lastUsedAt : null,
        viewCount: existing ? existing.viewCount || 0 : 0,
        useCount: existing ? existing.useCount || 0 : 0,
        patchCount: existing ? existing.patchCount || 0 : 0,
        packagePath: existing ? existing.packagePath || '' : '',
        scan: existing ? existing.scan || null : null,
        guardAction: existing ? existing.guardAction || '' : '',
        contentDigest: existing ? existing.contentDigest || '' : '',
        packageDigest: e.packageDigest != null ? str(e.packageDigest) : ((existing && existing.packageDigest) || ''),
        packageBytes: e.packageBytes != null ? num(e.packageBytes) : ((existing && existing.packageBytes) || 0),
        packageFiles: e.packageFiles != null ? normPackageFiles(e.packageFiles) : normPackageFiles(existing && existing.packageFiles),
        packageDiverged: e.packageDiverged != null ? !!e.packageDiverged : !!(existing && existing.packageDiverged),
        absorbedInto: existing ? existing.absorbedInto || '' : '',
        files: e.files != null ? normFiles(e.files) : (existing ? clone(existing.files || {}) : {})
      } };
    }

    /* PINNED IS A LOCK, NOT A LABEL. It used to be neither: the only thing protecting a pinned
       skill was a bullet in the curator's PROMPT ("Never modify pinned skills"), so any model
       that ignored it — or any ordinary agent run that never saw that prompt — could rewrite or
       archive the Commander's pinned procedure. A rule enforced only in a prompt is a suggestion.
       The one exemption is an explicit, forced call from the human surface: the Commander may
       overwrite their own pin deliberately (the panel sends force), never a model. */
    const CONTENT_ACTIONS = ['edit', 'patch', 'archive', 'delete', 'write_file', 'remove_file'];
    function pinnedGuard(existing, e, action) {
      if (!existing || !existing.pinned) return null;
      if (CONTENT_ACTIONS.indexOf(action) < 0) return null;
      const byHuman = str(e && e.createdBy) === 'user';
      if (byHuman && (e && e.force === true)) return null;
      return { ok: false, error: '"' + existing.name + '" is pinned - unpin it first (pinned skills are protected from ' + action + ')' };
    }

    function write(e) {
      e = e || {};
      const agentId = str(e.agentId) || 'agent';
      const n = cleanName(e.name);
      if (!n.ok) return { ok: false, error: n.error };
      const existing = find(agentId, n.name, { includeArchived: true });
      // write() is the compatibility wrapper, and on an existing name it is an EDIT — so it is a
      // content action and the pin applies. Without this, skill.write was a hole straight through
      // the guard below.
      const pinBlock = pinnedGuard(existing, e, 'edit');
      if (pinBlock) return pinBlock;
      if (!existing && countFor(agentId) >= maxPerAgent) return { ok: false, error: 'skill library is full (max ' + maxPerAgent + ') - edit or archive one first' };
      const made = makeEntry(Object.assign({}, e, { agentId, name: n.name, state: 'active' }), existing);
      if (!made.ok) return { ok: false, error: made.error };
      const entry = persist(made.entry);
      return { ok: true, skill: projectSkill(entry, true), edited: !!existing };
    }

    function patchBody(body, findText, replaceText) {
      const source = str(body);
      const needle = str(findText);
      if (!needle) return { ok: false, error: 'patch needs find text' };
      let idx = source.indexOf(needle);
      if (idx < 0) {
        const lower = source.toLowerCase();
        idx = lower.indexOf(needle.toLowerCase());
      }
      if (idx < 0) return { ok: false, error: 'patch text not found' };
      return { ok: true, body: source.slice(0, idx) + str(replaceText) + source.slice(idx + needle.length) };
    }

    function manage(e) {
      e = e || {};
      const agentId = str(e.agentId) || 'agent';
      const action = str(e.action || 'create').toLowerCase();
      const target = e.target != null ? e.target : (e.id != null ? e.id : e.name);
      let existing = null, made, entry, p, t;

      if (action === 'create') {
        const n = cleanName(e.name);
        if (!n.ok) return { ok: false, error: n.error };
        if (!str(e.body).trim()) return { ok: false, error: 'a new skill needs a body' };
        if (find(agentId, n.name, { includeArchived: true })) return { ok: false, error: 'a skill named "' + n.name + '" already exists - patch or edit it instead' };
        if (countFor(agentId) >= maxPerAgent) return { ok: false, error: 'skill library is full (max ' + maxPerAgent + ') - edit or archive one first' };
        made = makeEntry(Object.assign({}, e, { agentId, name: n.name, state: 'active' }), null);
        if (!made.ok) return { ok: false, error: made.error };
        entry = persist(made.entry);
        return { ok: true, action: 'create', skill: projectSkill(entry, true), edited: false };
      }

      existing = find(agentId, target, { includeArchived: true });
      if (!existing) return { ok: false, error: 'no such skill: ' + str(target || '') };

      const pinBlock = pinnedGuard(existing, e, action);
      if (pinBlock) return pinBlock;

      if (action === 'edit') {
        made = makeEntry(Object.assign({}, e, { agentId, name: existing.name }), existing);
        if (!made.ok) return { ok: false, error: made.error };
        made.entry.patchCount = (made.entry.patchCount || 0) + 1;
        if (e.packageDigest == null) made.entry.packageDiverged = !!made.entry.packageDigest;
        entry = persist(made.entry);
        return { ok: true, action: 'edit', skill: projectSkill(entry, true), edited: true };
      }

      if (action === 'patch') {
        p = patchBody(existing.body, e.find, e.replace);
        if (!p.ok) return p;
        made = makeEntry(Object.assign({}, existing, { agentId, name: existing.name, body: p.body }), existing);
        made.entry.patchCount = (made.entry.patchCount || 0) + 1;
        made.entry.packageDiverged = !!made.entry.packageDigest;
        entry = persist(made.entry);
        return { ok: true, action: 'patch', skill: projectSkill(entry, true), edited: true };
      }

      if (action === 'archive' || action === 'delete') {
        /* A CONSOLIDATION MUST NAME ITS HEIR. The curator's whole job is to fold narrow siblings
           into one umbrella, and its prompt already forbids archiving before the content is
           preserved — but nothing checked. An archive with no surviving target is indistinguishable
           from losing the skill, and "delete" is aliased to archive precisely so nothing is ever
           lost: keep that promise auditable. Only the curator is held to this; a Commander or an
           ordinary run may archive a skill for any reason. The heir must be LIVE (an archived heir
           is a chain into the dark) and must not be the skill itself. */
        const byCurator = str(e.createdBy) === 'curator';
        let heir = null;
        if (byCurator) {
          const want = str(e.absorbedInto || e.absorbed_into || e.mergedInto).trim();
          if (!want) return { ok: false, error: 'a curator archive must set absorbedInto to the skill that now carries this content' };
          heir = find(agentId, want, { includeArchived: false });
          if (!heir) return { ok: false, error: 'absorbedInto "' + want + '" is not a live skill - merge the content first, then archive' };
          if (heir.id === existing.id) return { ok: false, error: 'absorbedInto cannot be the skill being archived' };
        } else if (str(e.absorbedInto || '').trim()) {
          heir = find(agentId, str(e.absorbedInto).trim(), { includeArchived: false });
        }
        entry = clone(existing); entry.state = 'archived'; entry.updatedAt = now();
        if (heir) entry.absorbedInto = heir.name;
        entry = persist(entry);
        return { ok: true, action: 'archive', absorbedInto: entry.absorbedInto || '', skill: projectSkill(entry, true), edited: true };
      }
      if (action === 'restore') {
        entry = clone(existing); entry.state = 'active'; entry.updatedAt = now();
        entry = persist(entry);
        return { ok: true, action: 'restore', skill: projectSkill(entry, true), edited: true };
      }
      if (action === 'pin' || action === 'unpin') {
        entry = clone(existing); entry.pinned = action === 'pin' ? true : (e.pinned != null ? !!e.pinned : false); entry.updatedAt = now();
        entry = persist(entry);
        return { ok: true, action, skill: projectSkill(entry, true), edited: true };
      }
      if (action === 'write_file') {
        p = supportPath(e.path || e.file || e.filePath);
        if (!p.ok) return p;
        t = now();
        entry = clone(existing);
        entry.files = normFiles(entry.files);
        const encoding = e.encoding === 'base64' ? 'base64' : 'utf8';
        const content = encoding === 'base64' ? str(e.content).slice(0, Math.ceil(supportFileMax * 4 / 3) + 4) : red(e.content, supportFileMax);
        // Per-file bytes were already clamped above; these two bound the PACKAGE. Overwriting an
        // existing path is always allowed (it cannot grow the count, and its old bytes leave with it).
        const isNew = !entry.files[p.path];
        if (isNew && Object.keys(entry.files).length >= maxFiles) {
          return { ok: false, error: 'this skill already has ' + maxFiles + ' support files - replace or remove one instead' };
        }
        let bytes = str(entry.body).length + str(entry.setup).length;
        for (const k of Object.keys(entry.files)) if (k !== p.path) bytes += str(entry.files[k].content).length;
        if (bytes + content.length > maxPackageBytes) {
          return { ok: false, error: 'the skill package would exceed ' + maxPackageBytes + ' bytes - trim it or split the content into a second skill' };
        }
        entry.files[p.path] = { path: p.path, content: content, encoding, updatedAt: t };
        entry.packageDiverged = !!entry.packageDigest;
        entry.patchCount = (entry.patchCount || 0) + 1;
        entry.updatedAt = t;
        entry = persist(entry);
        return { ok: true, action: 'write_file', path: p.path, skill: projectSkill(entry, true), edited: true };
      }
      if (action === 'remove_file') {
        p = supportPath(e.path || e.file || e.filePath);
        if (!p.ok) return p;
        entry = clone(existing);
        entry.files = normFiles(entry.files);
        delete entry.files[p.path];
        entry.packageDiverged = !!entry.packageDigest;
        entry.patchCount = (entry.patchCount || 0) + 1;
        entry.updatedAt = now();
        entry = persist(entry);
        return { ok: true, action: 'remove_file', path: p.path, skill: projectSkill(entry, true), edited: true };
      }

      return { ok: false, error: 'unknown skill action: ' + action };
    }

    function list(agentId, opts2) {
      return mine(agentId, opts2).map(s => projectSkill(s, false));
    }
    function view(agentId, idOrName, opts2) {
      opts2 = opts2 || {};
      const s = find(agentId, idOrName, { includeArchived: !!opts2.includeArchived });
      if (!s) return null;
      let out = s;
      if (packageStore && typeof packageStore.hydrate === 'function' && opts2.hydrate !== false) {
        try {
          const h = packageStore.hydrate(projectSkill(s, true));
          if (h) out = Object.assign(clone(s), {
            body: h.body != null ? h.body : s.body,
            files: normFiles(h.files || s.files),
            packagePath: h.packagePath || s.packagePath || ''
          });
        } catch (_) {}
      }
      if (opts2.bump !== false) {
        const bumped = {
          viewCount: (s.viewCount || 0) + 1,
          useCount: (s.useCount || 0) + 1,
          lastUsedAt: now(),
          state: s.state === 'stale' ? 'active' : s.state
        };
        // RAM-only: the bump rides the next real mutation / compaction flush instead of appending a JSONL line
        // per view (unbounded growth was the whole problem). See bumpView.
        //
        // The bump carries ONLY the counters, and it carries them onto the STORED record — never onto the
        // hydrated copy. `out.body` may be the whole RENDERED SKILL.md (setup + body + support-file
        // pointers); writing that into `latest` makes the next persist — markUsed() runs on EVERY run —
        // re-render '## Setup' in front of a body that already has one, and persist() does not clamp, so
        // it grows without bound and re-stamps contentDigest (invalidating any Commander approval) every
        // single cycle.
        bumpView(Object.assign(clone(s), bumped));
        out = Object.assign(clone(out), bumped);
      }
      return projectSkill(out, true);
    }
    function markUsed(agentId, idOrNames) {
      const ids = Array.isArray(idOrNames) ? idOrNames : [idOrNames];
      let count = 0;
      for (const id of ids) {
        const s = find(agentId, id, { includeArchived: false });
        if (!s) continue;
        const entry = clone(s);
        entry.useCount = (entry.useCount || 0) + 1;
        entry.lastUsedAt = now();
        if (entry.state === 'stale') entry.state = 'active';
        persist(entry); count++;
      }
      return { ok: true, count };
    }
    /* compact — rewrite the append-only JSONL keeping ONLY the newest entry per (agentId, name). `latest`
       already holds exactly that (the boot load + every persist/bumpView collapse duplicates into it), so the
       compacted file is simply `latest`'s values, one line each. This does two jobs at once:
         1. bounds the file — months of edits/views collapse to one line per distinct skill;
         2. FLUSHES the RAM-only view/use bumps to disk (they became part of `latest` but were never appended).
       Requires an io that can atomically REPLACE the whole file (io.rewrite). Without it, compaction is a no-op
       (the bounded-read boot loader still keeps memory sane) — reported via `ok:false, reason`. Never throws:
       a compaction failure must never crash a run (the RAM mirror still answers). Returns counts for tests. */
    function compact() {
      const entries = Array.from(latest.values()).map(e => clone(e));
      if (!io || typeof io.rewrite !== 'function') return { ok: false, reason: 'io has no rewrite', kept: entries.length };
      try { io.rewrite(entries); return { ok: true, kept: entries.length }; }
      catch (e) { return { ok: false, reason: (e && e.message) || 'rewrite failed', kept: entries.length }; }
    }
    function curate(agentId, opts2) {
      opts2 = opts2 || {};
      const staleMs = opts2.staleMs > 0 ? opts2.staleMs : 30 * 24 * 60 * 60 * 1000;
      const archiveMs = opts2.archiveMs > 0 ? opts2.archiveMs : 90 * 24 * 60 * 60 * 1000;
      const t = opts2.now != null ? num(opts2.now) : now();
      let stale = 0, archived = 0;
      for (const s of mine(agentId, { includeArchived: true })) {
        if (s.pinned || s.state === 'archived') continue;
        const base = s.lastUsedAt || s.updatedAt || s.createdAt || t;
        const age = Math.max(0, t - base);
        const entry = clone(s);
        if (age >= archiveMs) { entry.state = 'archived'; archived++; }
        else if (age >= staleMs) { entry.state = 'stale'; stale++; }
        else continue;
        entry.updatedAt = t;
        persist(entry);
      }
      return { ok: true, stale, archived };
    }

    return {
      write, manage, list, view, markUsed, curate, compact,
      all() { return Array.from(latest.values()).map(s => projectSkill(s, true)); },
      count() { return latest.size; },
      _internals: { slug, keyOf, supportPath, cleanName, normalizeEntry, bumpView, trustSource }
    };
  }

  return { makeSkillStore };
});
