#!/usr/bin/env node
/* scripts/qa/bugs.mjs — the DURABLE BUG REGISTER (`npm run qa:bugs`).
 *
 * WHY THIS EXISTS: the ledger (scripts/qa/ledger.mjs) is the DETECTOR spine — scripts file
 * findings into `qa/findings/*.json`, which is gitignored and machine-local BY DESIGN (its
 * evidence[] paths point at absolute `.bugloops/` output, and dismissed/known triage is
 * ephemeral). That is correct for a detector, and fatal for a HUNT: when ten sweep lanes run
 * in ten worktrees, every lane re-finds the same defects, and everything a lane found dies
 * with its session. Nothing travels.
 *
 * This module is the layer the ledger deliberately is not: a TRACKED, portable backlog that
 * every lane reads before hunting and writes after finding — the same durable role
 * `qa/KNOWN_ISSUES.md` plays for suppression and `scripts/goldens.json` plays for blessed
 * frames. It is the hunt's shared memory.
 *
 * ONE FILE PER BUG — `qa/bugs/<fingerprint>-<slug>.md` — and that shape is load-bearing, not
 * taste. A single appended register (one BUGS.md everyone edits) is a HOTFILE: ten lanes
 * appending rows conflict on literally every merge, which is exactly the parallel-agent damage
 * this repo already fights. Distinct filenames never conflict. `qa/BUGS.md` is a GENERATED
 * index (`--index --write`), so a conflict there is resolved by regenerating, never by hand.
 *
 * IDENTITY IS (surface + slug), NOT THE TITLE. The fingerprint is derived once at creation
 * from the surface and the slug and then frozen into the filename, so re-wording a title later
 * never re-keys a bug into a "new" one. Same FNV-1a helper the ledger uses (imported, never
 * re-implemented) so a register fingerprint and a ledger fingerprint are the same kind of
 * token and can be cross-checked against the KNOWN_ISSUES baseline.
 *
 * HOUSE PATTERN (matches ledger.mjs / guardian.mjs / ready.mjs): the CORE is a PURE factory
 * `makeBugRegister({ io, clock })`. No ambient disk, no ambient time — the host injects both,
 * so the whole parse/validate/refuse/render judgement tests headlessly (test/qa-bugs.test.js)
 * and deterministically. The IO SHELL / CLI at the foot is the ONLY place fs + Date live.
 * ESM so this file is both the importable core and the `node scripts/qa/bugs.mjs` CLI; the
 * static imports are side-effect-free so require(esm) from the CJS test works with no
 * top-level await.
 *
 * THE LAWS `--validate` ENFORCES (it is wired into test/fast.list, so the register cannot rot):
 *   1. EVIDENCE LAW — every bug carries a non-empty `## Evidence` section. Same law as the
 *      ledger's `evidence-required`: a finding with no artifact is a vibe, not a bug.
 *   2. REPRO LAW — every bug carries a non-empty `## Repro`. A defect nobody can re-trigger
 *      cannot be proven fixed, so it can never leave the register honestly.
 *   3. NO-FAKE-FIXED — `status: fixed` REQUIRES a non-empty `fix:` (the commit that closed it).
 *      This is the register's version of the project's cardinal sin: a status field is the
 *      cheapest possible place to claim done without doing it.
 *   4. VERDICT LAW — `wontfix`/`duplicate` REQUIRE a non-empty `## Verdict` saying why. A bug
 *      may only leave the backlog by being fixed or by being argued out of it in writing.
 *   5. FILENAME AUTHORITY — the filename must be exactly `<fingerprint>-<slug>.md` and the
 *      frontmatter must agree. A hand-renamed file is a corrupt key, caught loudly.
 *   6. NO DUPLICATE FINGERPRINTS, and no OPEN bug whose fingerprint is on the KNOWN_ISSUES
 *      baseline (anti-nag: a known defect is not re-filed as fresh work).
 *   7. ANCHOR LAW (records found since ANCHOR_LAW_SINCE) — a bug must name at least one
 *      machine-checkable anchor: a test path, a repo file[:line], or the defective code quoted in
 *      backticks. scripts/qa/ledger-reconcile.mjs re-checks those anchors against the tree; a
 *      record with none can only ever be closed by a human re-reading it, which is how the
 *      register drifted to 25-of-28 "open" rows already fixed on trunk. Older records are
 *      grandfathered and reported as `unverifiable`.
 *
 * makeBugRegister({ io, clock }) -> {
 *   slugify(title)                  -> kebab slug
 *   fingerprintFor({surface,slug})  -> stable hex (the frozen identity)
 *   parse(file, text)               -> { ok, bug, errors[] }
 *   render(bug)                     -> the markdown file body
 *   create({title,surface,...})     -> { ok, status, reason?, bug? }   // refuses dup/known
 *   set(fingerprint, patch)         -> { ok, status, reason?, bug? }   // status/severity/lane/fix
 *   list(filter)                    -> bug[]
 *   validate()                      -> { ok, errors[], bugs[] }
 *   index()                         -> markdown for qa/BUGS.md
 *   counts()                        -> { open, bySeverity, byStatus, bySurface }
 * }
 *
 * CLI:
 *   node scripts/qa/bugs.mjs --new --title "..." --surface channels [--severity P1] [--lane x]
 *   node scripts/qa/bugs.mjs --list [--status open] [--surface x] [--severity P0] [--json]
 *   node scripts/qa/bugs.mjs --set <fingerprint> [--status fixed] [--fix <sha>] [--lane x] [--severity P1]
 *   node scripts/qa/bugs.mjs --index [--write]
 *   node scripts/qa/bugs.mjs --validate
 * Exit code: 0 on success; 2 when a create/set is refused or --validate finds a violation.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fingerprintOf } from './ledger.mjs';
import { LIFECYCLE_FIELDS, lifecycleErrors, coverageRows, escapeSummary, isEscape, makeCoverageChecker } from './bug-lifecycle.mjs';

/* ─────────────────────────────── PURE CORE ─────────────────────────────── */

// The surface slices the hunt is cut into. A bug MUST name one, because the register's whole
// job during a fan-out is telling a lane "this is yours" without a human triaging every row.
// Keep in sync with loops/sweep/<surface>.md — validate() checks the value, not the file.
export const SURFACES = Object.freeze([
  'channels',     // telegram / discord / comms / ACP ingress + egress
  'autonomy',     // cron, routines, night shift, loops, scheduler truth
  'providers',    // model routing, OAuth, keys, spend + billing honesty
  'safecell',     // consent broker, permissions, path trust, shell/files jail
  'sessions',     // workstreams, projects, transcripts, save/restore
  'skills',       // skills, recipes, the skill guard, marketplace
  'onboarding',   // awakening, interview, recruitment, first-run
  'world',        // canvas, props, sprites, windows, COMMS, theming
  'voice',        // TTS, speech queue, voice chat
  'release'       // installer, updater, signing, desktop shell, migration
]);
const SURFACE_SET = new Set(SURFACES);

const SEVERITIES = Object.freeze(['P0', 'P1', 'P2']);
const SEV_ORDER = { P0: 0, P1: 1, P2: 2 };
const STATUSES = Object.freeze(['open', 'claimed', 'fixed', 'wontfix', 'duplicate']);
const STATUS_ORDER = { open: 0, claimed: 1, fixed: 2, duplicate: 3, wontfix: 4 };
// A bug still costs the project something until it is fixed or argued away in writing.
const ACTIVE_STATUSES = new Set(['open', 'claimed']);

const SECTIONS = Object.freeze(['Symptom', 'Repro', 'Evidence', 'Verdict']);
const TITLE_MAX = 160;
const SLUG_MAX = 48;

// The scaffold `--new` writes. These EXACT strings read back as EMPTY, so a freshly-created bug
// cannot pass the Evidence/Repro laws until a human actually fills it in. Matched exactly and
// never by shape: an earlier draft treated ANY italic line as a placeholder, which would have
// silently swallowed a perfectly good one-line evidence note like `_see .bugloops/x.png_` and
// then failed the gate with "is empty" against text the author could plainly see.
const PLACEHOLDERS = Object.freeze({
  Symptom: '_What the user sees. One paragraph, no diagnosis._',
  Repro: '_Numbered steps from a known start state. Anyone must be able to re-trigger this._',
  Evidence: '_Artifact paths, log lines, DOM round-trip output, screenshots. Never a claim alone._',
  Verdict: '_Filled in when the bug leaves the backlog: what was true, and why it is closed._'
});
const PLACEHOLDER_SET = new Set(Object.keys(PLACEHOLDERS).map(k => PLACEHOLDERS[k]));

function str(v) { return v == null ? '' : String(v); }
function trimmed(v) { return str(v).trim(); }

export function slugify(title) {
  return trimmed(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

// Identity = surface + slug, frozen into the filename at creation. Deliberately NOT the title:
// a bug's wording is refined as it is understood, and a re-key would resurrect it as a new row
// and defeat the dedup that is this file's reason to exist.
export function fingerprintFor(parts) {
  parts = parts || {};
  return fingerprintOf({ crew: parts.surface, checkId: 'bug', subject: parts.slug });
}

export function fileNameFor(bug) {
  return trimmed(bug && bug.fingerprint) + '-' + trimmed(bug && bug.slug) + '.md';
}

/* ───────────────────────── MACHINE-CHECKABLE ANCHORS (Law 7) ─────────────────────────
 * A bug record is only reconcilable by a machine if it NAMES something a machine can re-check on
 * the current tree: a test file (does it exist, does it pass), a repo file[:line] (does the cited
 * code still exist), or an inline code snippet quoted from that file (is the defect still there).
 * Without one of those a record can only be closed by a human re-reading it — which is exactly
 * how the register drifted to ~25 of 28 "open" rows being already fixed on trunk. From
 * ANCHOR_LAW_SINCE a new record MUST carry at least one anchor; older records are grandfathered
 * (the reconciler lists them as `unverifiable` so they can be back-filled, never silently kept).
 *
 * extractAnchors(bug) is PURE text parsing over the record's `fix:` field and its four sections.
 * It is shared with scripts/qa/ledger-reconcile.mjs so the validator and the reconciler can never
 * disagree about what counts as an anchor. */
export const ANCHOR_LAW_SINCE = '2026-08-21';

// Repo roots a cited file may live under. `test/` is deliberately separate (it is the TEST anchor).
const CODE_ROOTS = '(?:test|sidecar|frontend|shared|scripts|desktop|website|loops|docs|dev|qa|bin|src)';
const RE_TEST = /\btest\/[\w./-]+?\.(?:m?js|cjs)\b/g;
const RE_FILE = new RegExp('(?:^|[\\s`(\\[])(' + CODE_ROOTS + '\\/[\\w./-]+?\\.[A-Za-z]{1,5})(?::(\\d+)(?:-(\\d+))?)?(?=$|[\\s`)\\],;:])', 'gm');
const RE_SNIPPET = /`([^`\n]{12,240})`/g;
const RE_HEX = /\b[0-9a-f]{7,40}\b/g;

function looksLikeCode(s) {
  // a quoted snippet that is CODE, not a path or a prose phrase: needs a call, assignment,
  // comparison, arrow, block or statement terminator — and must not itself be a bare file path.
  if (/^(?:test|sidecar|frontend|shared|scripts|desktop|website|loops|docs|dev|qa)\/[\w./-]+(?::\d+(?:-\d+)?)?$/.test(s)) return false;
  return /[(){};]|=>|==|!=|\s=\s|\.\w+\(/.test(s);
}

export function extractAnchors(bug) {
  bug = bug || {};
  const sections = bug.sections || {};
  const out = { commits: [], tests: [], regressionTests: [], files: [], snippets: [], count: 0 };
  const seenTest = new Set(), seenFile = new Set(), seenSnip = new Set(), seenCommit = new Set();

  const fix = trimmed(bug.fix);
  const fp = trimmed(bug.fingerprint).toLowerCase();
  for (const m of fix.toLowerCase().match(RE_HEX) || []) { if (m !== fp && !seenCommit.has(m)) { seenCommit.add(m); out.commits.push(m); } }
  // A commit named in the Verdict ("Fixed by abc1234", "landed in `deadbeef`") is closure
  // evidence too — but never the record's own 8-hex fingerprint.
  // Reported escapes often name RELATED fixes while explaining why the report stays open.
  // Only their explicit fix field asserts causality; legacy sweep prose keeps its old semantics.
  if (!isEscape(bug)) for (const m of str(sections.Verdict).toLowerCase().match(RE_HEX) || []) { if (m !== fp && !seenCommit.has(m)) { seenCommit.add(m); out.commits.push(m); } }

  for (const name of SECTIONS) {
    const text = str(sections[name]);
    if (!text) continue;
    for (const m of text.match(RE_TEST) || []) {
      const t = m.replace(/\\/g, '/');
      if (!seenTest.has(t)) { seenTest.add(t); out.tests.push(t); }
      // A test named in the VERDICT is the regression the fix left behind (hard evidence when it
      // passes); one named elsewhere is "existing coverage" that passed BEFORE the fix too (weak).
      if (name === 'Verdict' && (!isEscape(bug) || fix) && !out.regressionTests.includes(t)) out.regressionTests.push(t);
    }
    // file[:line] citations, in document order, so a snippet can bind to the nearest one above it.
    const cites = [];
    let fm;
    RE_FILE.lastIndex = 0;
    while ((fm = RE_FILE.exec(text))) {
      const file = fm[1].replace(/\\/g, '/');
      const line = fm[2] ? Number(fm[2]) : null;
      // a test path still BINDS the snippets quoted after it (so a line quoted from a test is
      // never mistaken for defect code), but it is a TEST anchor, not a file anchor.
      cites.push({ at: fm.index, file, line });
      if (/^test\//.test(file)) continue;
      const key = file + ':' + (line == null ? '' : line);
      if (!seenFile.has(key)) { seenFile.add(key); out.files.push({ file, line, section: name }); }
    }
    let sm;
    RE_SNIPPET.lastIndex = 0;
    while ((sm = RE_SNIPPET.exec(text))) {
      const snip = sm[1].trim();
      if (!looksLikeCode(snip)) continue;
      let file = '';
      for (const c of cites) { if (c.at < sm.index) file = c.file; else break; }
      const key = file + '|' + snip;
      if (seenSnip.has(key)) continue;
      seenSnip.add(key);
      out.snippets.push({ text: snip, file, section: name });
    }
  }
  out.count = out.tests.length + out.files.length + out.snippets.length;
  return out;
}

// Does this record fall under Law 7? Grandfathering is by the record's own `found` date, which the
// filename-authority law already makes immutable in practice (a re-dated record re-keys nothing,
// but a reviewer sees the diff).
export function anchorLawApplies(bug) {
  const found = trimmed(bug && bug.found);
  return /^\d{4}-\d{2}-\d{2}$/.test(found) && found >= ANCHOR_LAW_SINCE;
}

// Deliberately NOT a YAML parser. The frontmatter is a flat `key: value` block by design — the
// repo carries zero runtime deps, and a real YAML surface would invite nesting that the laws
// above could not check. Unknown keys are preserved so a lane can annotate without data loss.
function parseFrontmatter(text) {
  const lines = str(text).replace(/^﻿/, '').split(/\r?\n/);
  if (trimmed(lines[0]) !== '---') return { ok: false, reason: 'missing opening --- frontmatter fence' };
  const meta = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (trimmed(line) === '---') break;
    if (!trimmed(line)) continue;
    const at = line.indexOf(':');
    if (at < 0) return { ok: false, reason: 'frontmatter line is not `key: value`: ' + line.slice(0, 60) };
    const key = trimmed(line.slice(0, at));
    if (!key) return { ok: false, reason: 'frontmatter line has an empty key' };
    meta[key] = trimmed(line.slice(at + 1));
  }
  if (i >= lines.length) return { ok: false, reason: 'missing closing --- frontmatter fence' };
  return { ok: true, meta, body: lines.slice(i + 1).join('\n') };
}

// Split the body on `## <Section>` headings. A section's content is everything up to the next
// `##`; an untouched template placeholder (matched EXACTLY, see PLACEHOLDERS) counts as EMPTY so
// a freshly-scaffolded bug cannot pass the Evidence/Repro laws without someone filling it in.
function parseSections(body) {
  const out = {};
  const lines = str(body).split(/\r?\n/);
  let current = '';
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { current = m[1]; out[current] = out[current] || []; continue; }
    if (current) out[current].push(line);
  }
  const clean = {};
  for (const key of Object.keys(out)) {
    const text = out[key]
      .filter(l => !PLACEHOLDER_SET.has(trimmed(l)))   // an untouched scaffold line is not content
      .join('\n')
      .trim();
    clean[key] = text;
  }
  return clean;
}

export function makeBugRegister(opts) {
  opts = opts || {};
  const io = opts.io || {};
  const clock = opts.clock || { today() { return '1970-01-01'; } };
  const listBugs = typeof io.listBugs === 'function' ? io.listBugs.bind(io) : () => [];
  const writeBug = typeof io.writeBug === 'function' ? io.writeBug.bind(io) : () => {};
  const knownIo = typeof io.knownFingerprints === 'function' ? io.knownFingerprints.bind(io) : () => [];

  function today() {
    try { const d = trimmed(clock.today && clock.today()); return d || '1970-01-01'; }
    catch (_) { return '1970-01-01'; }
  }

  function knownSet() {
    const set = new Set();
    try {
      const seed = knownIo();
      const arr = seed instanceof Set ? Array.from(seed) : (Array.isArray(seed) ? seed : []);
      for (const fp of arr) { const s = trimmed(fp).toLowerCase(); if (s) set.add(s); }
    } catch (_) { /* fail-open: no baseline -> nothing suppressed */ }
    return set;
  }

  function parse(file, text) {
    const errors = [];
    const fm = parseFrontmatter(text);
    if (!fm.ok) return { ok: false, bug: null, errors: [file + ': ' + fm.reason] };

    const meta = fm.meta;
    const sections = parseSections(fm.body);
    const bug = {
      file: trimmed(file),
      fingerprint: trimmed(meta.fingerprint).toLowerCase(),
      slug: trimmed(meta.slug),
      title: trimmed(meta.title),
      surface: trimmed(meta.surface).toLowerCase(),
      severity: trimmed(meta.severity).toUpperCase(),
      status: trimmed(meta.status).toLowerCase(),
      found: trimmed(meta.found),
      lane: trimmed(meta.lane),
      fix: trimmed(meta.fix),
      sections,
      meta
    };
    for (const field of LIFECYCLE_FIELDS) bug[field] = trimmed(meta[field]);

    if (!bug.fingerprint) errors.push(file + ': frontmatter `fingerprint` is required');
    if (!bug.slug) errors.push(file + ': frontmatter `slug` is required');
    if (!bug.title) errors.push(file + ': frontmatter `title` is required');
    if (!SURFACE_SET.has(bug.surface)) errors.push(file + ': `surface` must be one of ' + SURFACES.join('/') + ' (got "' + bug.surface + '")');
    if (SEV_ORDER[bug.severity] == null) errors.push(file + ': `severity` must be one of ' + SEVERITIES.join('/') + ' (got "' + bug.severity + '")');
    if (STATUS_ORDER[bug.status] == null) errors.push(file + ': `status` must be one of ' + STATUSES.join('/') + ' (got "' + bug.status + '")');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bug.found)) errors.push(file + ': `found` must be an absolute YYYY-MM-DD date (got "' + bug.found + '")');

    // Law 5 — the filename IS the key. A hand-rename silently orphans a bug from its identity.
    if (bug.fingerprint && bug.slug) {
      const want = fileNameFor(bug);
      if (bug.file && bug.file !== want) errors.push(file + ': filename must be `' + want + '` (frontmatter fingerprint+slug are the key)');
      const derived = fingerprintFor({ surface: bug.surface, slug: bug.slug });
      if (SURFACE_SET.has(bug.surface) && derived !== bug.fingerprint) {
        errors.push(file + ': `fingerprint` ' + bug.fingerprint + ' does not match surface+slug (expected ' + derived + ')');
      }
    }

    // Law 1 + Law 2 — evidence and repro, on every bug, always.
    if (!trimmed(sections.Evidence)) errors.push(file + ': `## Evidence` is empty — a finding with no artifact is a vibe, not a bug');
    if (!trimmed(sections.Repro)) errors.push(file + ': `## Repro` is empty — a defect nobody can re-trigger can never be proven fixed');

    // Law 7 — a NEW record must be machine-reconcilable: at least one test path, repo file[:line]
    // or quoted code snippet. Records found before ANCHOR_LAW_SINCE are grandfathered (the
    // reconciler reports them as `unverifiable`).
    bug.anchors = extractAnchors(bug);
    if (anchorLawApplies(bug) && bug.anchors.count === 0) {
      errors.push(file + ': carries no machine-checkable anchor — name a repro test (`test/x.test.js`), a file (`sidecar/x.js:123`) or quote the defective code in backticks (records found since ' + ANCHOR_LAW_SINCE + ' must be reconcilable by `npm run qa:reconcile`)');
    }

    // Law 3 — no-fake-fixed.
    if (bug.status === 'fixed' && !bug.fix) errors.push(file + ': `status: fixed` requires a non-empty `fix:` (the commit that closed it)');
    // Law 4 — a bug leaves the backlog fixed, or argued out of it in writing.
    if ((bug.status === 'wontfix' || bug.status === 'duplicate') && !trimmed(sections.Verdict)) {
      errors.push(file + ': `status: ' + bug.status + '` requires a non-empty `## Verdict` saying why');
    }

    errors.push(...lifecycleErrors(bug).map(e => file + ': ' + e));
    return { ok: errors.length === 0, bug, errors };
  }

  function render(bug) {
    bug = bug || {};
    const sections = bug.sections || {};
    const lines = [];
    lines.push('---');
    lines.push('fingerprint: ' + trimmed(bug.fingerprint));
    lines.push('slug: ' + trimmed(bug.slug));
    lines.push('title: ' + trimmed(bug.title).slice(0, TITLE_MAX));
    lines.push('surface: ' + trimmed(bug.surface));
    lines.push('severity: ' + trimmed(bug.severity));
    lines.push('status: ' + trimmed(bug.status));
    lines.push('found: ' + trimmed(bug.found));
    lines.push('lane: ' + trimmed(bug.lane));
    lines.push('fix:' + (trimmed(bug.fix) ? ' ' + trimmed(bug.fix) : ''));
    for (const field of LIFECYCLE_FIELDS) if (trimmed(bug[field])) lines.push(field + ': ' + trimmed(bug[field]).replace(/[\r\n]/g, ' '));
    lines.push('---');
    lines.push('');
    lines.push('# ' + trimmed(bug.title));
    lines.push('');
    for (const name of [...SECTIONS, ...Object.keys(sections).filter(k => !SECTIONS.includes(k))]) {
      lines.push('## ' + name);
      lines.push('');
      lines.push(trimmed(sections[name]) || PLACEHOLDERS[name] || '');
      lines.push('');
    }
    return lines.join('\n');
  }

  function load() {
    const out = [];
    let raw = [];
    try { raw = listBugs() || []; } catch (_) { raw = []; }
    for (const entry of raw) {
      const file = trimmed(entry && entry.file);
      const text = str(entry && entry.text);
      out.push(parse(file, text));
    }
    return out;
  }

  function list(filter) {
    filter = filter || {};
    const wantStatus = trimmed(filter.status).toLowerCase();
    const wantSurface = trimmed(filter.surface).toLowerCase();
    const wantSeverity = trimmed(filter.severity).toUpperCase();
    const rows = load().map(r => r.bug).filter(Boolean).filter(b => {
      if (wantStatus && b.status !== wantStatus) return false;
      if (wantSurface && b.surface !== wantSurface) return false;
      if (wantSeverity && b.severity !== wantSeverity) return false;
      return true;
    });
    // Deterministic ordering: worst-and-least-settled first, then surface, then slug — so two
    // runs over the same register render an identical index and the diff is meaningful.
    rows.sort((a, b) =>
      (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) ||
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.surface.localeCompare(b.surface) ||
      a.slug.localeCompare(b.slug)
    );
    return rows;
  }

  function findByFingerprint(fp) {
    const want = trimmed(fp).toLowerCase();
    if (!want) return null;
    for (const r of load()) if (r.bug && r.bug.fingerprint === want) return r.bug;
    return null;
  }

  function create(input) {
    input = input || {};
    const title = trimmed(input.title);
    if (!title) return { ok: false, status: 'rejected', reason: 'title-required: a bug must have a non-empty title' };

    const surface = trimmed(input.surface).toLowerCase();
    if (!SURFACE_SET.has(surface)) {
      return { ok: false, status: 'rejected', reason: 'surface-required: must be one of ' + SURFACES.join('/') + ' (got "' + surface + '")' };
    }

    const slug = trimmed(input.slug) ? slugify(input.slug) : slugify(title);
    if (!slug) return { ok: false, status: 'rejected', reason: 'slug-required: the title produced an empty slug — give an explicit --slug' };

    const severity = trimmed(input.severity).toUpperCase() || 'P1';
    if (SEV_ORDER[severity] == null) return { ok: false, status: 'rejected', reason: 'severity must be one of ' + SEVERITIES.join('/') };

    const fingerprint = fingerprintFor({ surface, slug });

    // Anti-nag law, same as the ledger's: a fingerprint the KNOWN_ISSUES baseline already
    // carries is a defect the project has consciously accepted. It never re-files as fresh work.
    if (knownSet().has(fingerprint)) {
      return { ok: false, status: 'refused', reason: 'known: fingerprint ' + fingerprint + ' is on the qa/KNOWN_ISSUES.md baseline — never re-filed', fingerprint };
    }

    const dup = findByFingerprint(fingerprint);
    if (dup) {
      // Idempotent, exactly like the ledger: the same defect never files twice, and a lane that
      // re-finds a known bug learns who already owns it instead of opening a second row.
      return { ok: true, status: 'duplicate', reason: 'already filed as ' + dup.file + ' (status ' + dup.status + (dup.lane ? ', lane ' + dup.lane : '') + ')', bug: dup };
    }

    const bug = {
      fingerprint,
      slug,
      title: title.slice(0, TITLE_MAX),
      surface,
      severity,
      status: 'open',
      found: trimmed(input.found) || today(),
      lane: trimmed(input.lane),
      fix: '',
      sections: {
        Symptom: trimmed(input.symptom),
        Repro: trimmed(input.repro),
        Evidence: trimmed(input.evidence),
        Verdict: ''
      }
    };
    bug.file = fileNameFor(bug);
    for (const field of LIFECYCLE_FIELDS) bug[field] = trimmed(input[field]);
    if (!bug.origin && bug.found >= '2026-09-05') bug.origin = 'unknown';
    if (isEscape(bug)) {
      bug.installer ||= 'unverified'; bug.recovery ||= 'unconfirmed';
      bug.sections.Regression = ''; bug.sections['Sibling coverage'] = '';
    }

    let persisted = true;
    try { writeBug(bug.file, render(bug)); }
    catch (_) { persisted = false; }
    if (!persisted) return { ok: false, status: 'write-failed', reason: 'bug rendered but io.writeBug threw (disk problem)', bug };
    return { ok: true, status: 'created', bug };
  }

  function set(fingerprint, patch) {
    patch = patch || {};
    const bug = findByFingerprint(fingerprint);
    if (!bug) return { ok: false, status: 'not-found', reason: 'no bug with fingerprint ' + trimmed(fingerprint) };

    const next = Object.assign({}, bug, { sections: Object.assign({}, bug.sections) });
    if (patch.status != null) {
      const s = trimmed(patch.status).toLowerCase();
      if (STATUS_ORDER[s] == null) return { ok: false, status: 'rejected', reason: 'status must be one of ' + STATUSES.join('/') };
      next.status = s;
    }
    if (patch.severity != null) {
      const s = trimmed(patch.severity).toUpperCase();
      if (SEV_ORDER[s] == null) return { ok: false, status: 'rejected', reason: 'severity must be one of ' + SEVERITIES.join('/') };
      next.severity = s;
    }
    if (patch.lane != null) next.lane = trimmed(patch.lane);
    if (patch.fix != null) next.fix = trimmed(patch.fix);
    if (patch.verdict != null) next.sections.Verdict = trimmed(patch.verdict);
    for (const field of LIFECYCLE_FIELDS) if (patch[field] != null) next[field] = trimmed(patch[field]);
    if (patch.regression != null) next.sections.Regression = trimmed(patch.regression);
    if (patch.coverage != null) next.sections['Sibling coverage'] = trimmed(patch.coverage);

    // Law 3 + Law 4 enforced at the WRITE seam, not only at validate() — so a `--set --status
    // fixed` with no commit is refused at the moment of the lie, where it is cheapest to correct.
    if (next.status === 'fixed' && !next.fix) {
      return { ok: false, status: 'rejected', reason: 'no-fake-fixed: `--status fixed` requires `--fix <commit>`' };
    }
    if ((next.status === 'wontfix' || next.status === 'duplicate') && !trimmed(next.sections.Verdict)) {
      return { ok: false, status: 'rejected', reason: 'verdict-required: `--status ' + next.status + '` requires `--verdict "<why>"`' };
    }

    const lifecycle = lifecycleErrors(next);
    if (typeof io.checkCoverage === 'function') for (const row of coverageRows(next)) {
      const reason = io.checkCoverage(row); if (reason) lifecycle.push(reason);
    }
    if (lifecycle.length) return { ok: false, status: 'rejected', reason: lifecycle.join('; ') };
    let persisted = true;
    try { writeBug(next.file, render(next)); }
    catch (_) { persisted = false; }
    if (!persisted) return { ok: false, status: 'write-failed', reason: 'bug rendered but io.writeBug threw (disk problem)', bug: next };
    return { ok: true, status: 'updated', bug: next };
  }

  function validate() {
    const parsed = load();
    const errors = [];
    const seen = new Map();
    for (const r of parsed) {
      for (const e of r.errors) errors.push(e);
      const bug = r.bug;
      if (bug && typeof io.checkCoverage === 'function') {
        for (const row of coverageRows(bug)) {
          const reason = io.checkCoverage(row);
          if (reason) errors.push(bug.file + ': ' + reason);
        }
      }
      if (!bug || !bug.fingerprint) continue;
      // Law 6 — one row per defect. Two files on one fingerprint means the register is lying
      // about how many distinct bugs exist, which is the one thing it must never do.
      if (seen.has(bug.fingerprint)) {
        errors.push(bug.file + ': duplicate fingerprint ' + bug.fingerprint + ' (also ' + seen.get(bug.fingerprint) + ')');
      } else {
        seen.set(bug.fingerprint, bug.file);
      }
    }
    const known = knownSet();
    for (const r of parsed) {
      const bug = r.bug;
      if (!bug) continue;
      if (ACTIVE_STATUSES.has(bug.status) && known.has(bug.fingerprint)) {
        errors.push(bug.file + ': fingerprint is on the qa/KNOWN_ISSUES.md baseline but is still ' + bug.status + ' — accept it or retire the baseline row');
      }
    }
    return { ok: errors.length === 0, errors, bugs: parsed.map(r => r.bug).filter(Boolean) };
  }

  function counts() {
    const bugs = load().map(r => r.bug).filter(Boolean);
    const bySeverity = { P0: 0, P1: 0, P2: 0 };
    const byStatus = {};
    const bySurface = {};
    for (const s of STATUSES) byStatus[s] = 0;
    for (const s of SURFACES) bySurface[s] = 0;
    let open = 0;
    for (const b of bugs) {
      if (byStatus[b.status] != null) byStatus[b.status]++;
      if (!ACTIVE_STATUSES.has(b.status)) continue;
      open++;
      if (bySeverity[b.severity] != null) bySeverity[b.severity]++;
      if (bySurface[b.surface] != null) bySurface[b.surface]++;
    }
    return { total: bugs.length, open, bySeverity, byStatus, bySurface };
  }

  // The generated qa/BUGS.md. Generated, never hand-edited — that is what keeps a ten-lane
  // fan-out from turning the index into a permanent merge conflict.
  function index() {
    const bugs = list();
    const c = counts();
    const lines = [];
    lines.push('# QA bug register');
    lines.push('');
    lines.push('**GENERATED — do not hand-edit.** Rebuild with `npm run qa:bugs:index`.');
    lines.push('One tracked file per bug under `qa/bugs/`; this is only the index. File a new bug with');
    lines.push('`node scripts/qa/bugs.mjs --new --title "..." --surface <surface>`.');
    lines.push('');
    lines.push('**' + c.open + '** open (open+claimed) of ' + c.total + ' total — ' +
      c.bySeverity.P0 + ' P0 · ' + c.bySeverity.P1 + ' P1 · ' + c.bySeverity.P2 + ' P2');
    lines.push('');
    const outcomes = escapeSummary(bugs);
    lines.push('Engineering status is separate from delivery and customer recovery. Legacy rows without origin are not a customer census.');
    lines.push('');
    lines.push('User/owner reports: **' + outcomes.reports + '** · source fixed: **' + outcomes.sourceFixed +
      '** · installer verified: **' + outcomes.installerVerified + '** · customer confirmed: **' + outcomes.customerConfirmed +
      '** · still reported failing: **' + outcomes.customerPersists + '** · recovery unconfirmed: **' + outcomes.customerUnconfirmed + '**.');
    lines.push('');
    if (outcomes.reports) {
      lines.push('| Report | Family | Source | Installer | Customer |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const b of bugs.filter(isEscape)) lines.push('| [' + b.title.replace(/\|/g, '\\|') + '](bugs/' + b.file + ') | ' + b.family + ' | ' + b.status + ' | ' + b.installer + ' | ' + b.recovery + ' |');
      lines.push('');
    }
    if (!bugs.length) {
      lines.push('_Register empty. No bug has been filed yet._');
      lines.push('');
      return lines.join('\n');
    }
    lines.push('| Sev | Status | Surface | Bug | Lane | Fix |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const b of bugs) {
      const title = b.title.replace(/\|/g, '\\|');
      lines.push('| ' + b.severity + ' | ' + b.status + ' | ' + b.surface +
        ' | [' + title + '](bugs/' + b.file + ') | ' + (b.lane || '—') + ' | ' + (b.fix || '—') + ' |');
    }
    lines.push('');
    lines.push('## Open by surface');
    lines.push('');
    lines.push('| Surface | Open |');
    lines.push('| --- | --- |');
    for (const s of SURFACES) lines.push('| ' + s + ' | ' + c.bySurface[s] + ' |');
    lines.push('');
    return lines.join('\n');
  }

  return {
    slugify, fingerprintFor, fileNameFor,
    parse, render, create, set, list, validate, index, counts,
    find: findByFingerprint,
    _internals: { parseFrontmatter, parseSections, knownSet }
  };
}

/* ───────────────────────────── THIN CLI WRAPPER ─────────────────────────────
 * Only runs when invoked directly. The ONLY place ambient fs + Date live (the composition
 * root), exactly like ledger.mjs's CLI block. The static imports above are side-effect-free so
 * require(esm) from the CJS test still works.
 */

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
  catch (_) { return false; }
})();

if (INVOKED_DIRECTLY) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ROOT = path.resolve(__dirname, '..', '..');            // scripts/qa/ -> repo root
  const BUGS_DIR = path.join(ROOT, 'qa', 'bugs');
  const INDEX_FILE = path.join(ROOT, 'qa', 'BUGS.md');
  const KNOWN_FILE = path.join(ROOT, 'qa', 'KNOWN_ISSUES.md');

  // Same scrape the ledger CLI uses, so ONE baseline file suppresses re-filing in BOTH spines.
  const readKnownFingerprints = () => {
    try {
      const txt = fs.readFileSync(KNOWN_FILE, 'utf8');
      const out = new Set();
      const re = /fingerprint[:=]\s*`?([0-9a-fA-F]{6,})`?/g;
      let m;
      while ((m = re.exec(txt))) out.add(m[1].toLowerCase());
      return out;
    } catch (_) { return new Set(); }
  };

  const realIo = () => ({
    checkCoverage: makeCoverageChecker(ROOT),
    listBugs() {
      let names;
      try { names = fs.readdirSync(BUGS_DIR); } catch (_) { return []; }
      const out = [];
      for (const n of names.sort()) {
        if (!n.endsWith('.md')) continue;
        if (n === 'README.md') continue;             // the directory's own doc is not a bug

        try { out.push({ file: n, text: fs.readFileSync(path.join(BUGS_DIR, n), 'utf8') }); }
        catch (_) { /* skip an unreadable bug file; validate() reports the gap as a parse error */ }
      }
      return out;
    },
    writeBug(file, text) {
      fs.mkdirSync(BUGS_DIR, { recursive: true });
      const safe = String(file).replace(/[^A-Za-z0-9._-]/g, '_');
      fs.writeFileSync(path.join(BUGS_DIR, safe), text, 'utf8');
    },
    knownFingerprints() { return readKnownFingerprints(); }
  });

  const parseArgs = (argv) => {
    const a = { _: [] };
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i];
      if (t === '--new') a.new = true;
      else if (t === '--list') a.list = true;
      else if (t === '--index') a.index = true;
      else if (t === '--validate') a.validate = true;
      else if (t === '--json') a.json = true;
      else if (t === '--write') a.write = true;
      else if (t === '--set') a.set = argv[++i] || '';
      else if (t === '--title') a.title = argv[++i] || '';
      else if (t === '--slug') a.slug = argv[++i] || '';
      else if (t === '--surface') a.surface = argv[++i] || '';
      else if (t === '--severity') a.severity = argv[++i] || '';
      else if (t === '--status') a.status = argv[++i] || '';
      else if (t === '--lane') a.lane = argv[++i] || '';
      else if (t === '--fix') a.fix = argv[++i] || '';
      else if (t === '--verdict') a.verdict = argv[++i] || '';
      else if (t === '--found') a.found = argv[++i] || '';
      else if (LIFECYCLE_FIELDS.some(f => '--' + f === t)) a[t.slice(2)] = argv[++i] || '';
      else if (t === '--regression') a.regression = argv[++i] || '';
      else if (t === '--coverage') a.coverage = argv[++i] || '';
      else a._.push(t);
    }
    return a;
  };

  const args = parseArgs(process.argv.slice(2));
  const reg = makeBugRegister({
    io: realIo(),
    clock: { today: () => new Date().toISOString().slice(0, 10) }   // real clock: composition root only
  });

  const writeIndex = () => {
    fs.writeFileSync(INDEX_FILE, reg.index() + '\n', 'utf8');
    console.error('[qa:bugs] wrote ' + path.relative(ROOT, INDEX_FILE));
  };

  if (args.new) {
    const res = reg.create({
      title: args.title, slug: args.slug, surface: args.surface,
      severity: args.severity, lane: args.lane, found: args.found,
      ...Object.fromEntries(LIFECYCLE_FIELDS.map(f => [f, args[f]]))
    });
    if (res.ok && res.status === 'created') {
      writeIndex();
      console.log('CREATED qa/bugs/' + res.bug.file + '  [' + res.bug.severity + ' · ' + res.bug.surface + ']  fp=' + res.bug.fingerprint);
      console.log('Fill in ## Symptom, ## Repro and ## Evidence — an unfilled bug FAILS `--validate`.');
      console.log('Name at least one machine-checkable anchor (a `test/x.test.js`, a `sidecar/x.js:123`, or the defective code in backticks) — an anchor-less record FAILS `--validate` (Law 7).');
      process.exit(0);
    }
    if (res.ok && res.status === 'duplicate') { console.log('DUPLICATE — ' + res.reason); process.exit(0); }
    console.error((res.status === 'refused' ? 'REFUSED' : 'REJECTED') + ' — ' + res.reason);
    process.exit(2);
  } else if (args.set) {
    const res = reg.set(args.set, {
      status: args.status, severity: args.severity, lane: args.lane,
      fix: args.fix, verdict: args.verdict, regression: args.regression, coverage: args.coverage,
      ...Object.fromEntries(LIFECYCLE_FIELDS.map(f => [f, args[f]]))
    });
    if (res.ok) {
      writeIndex();
      console.log('UPDATED qa/bugs/' + res.bug.file + '  [' + res.bug.severity + ' · ' + res.bug.status + (res.bug.fix ? ' · ' + res.bug.fix : '') + ']');
      process.exit(0);
    }
    console.error('REJECTED — ' + res.reason);
    process.exit(2);
  } else if (args.list) {
    const rows = reg.list({ status: args.status, surface: args.surface, severity: args.severity });
    if (args.json) { process.stdout.write(JSON.stringify(rows, null, 2) + '\n'); process.exit(0); }
    if (!rows.length) { console.log('(no bugs match)'); process.exit(0); }
    for (const b of rows) {
      console.log(b.severity + '  ' + b.status.padEnd(9) + ' ' + b.surface.padEnd(11) + ' ' + b.fingerprint + '  ' + b.title);
    }
    const c = reg.counts();
    console.log('\n' + c.open + ' open of ' + c.total + ' total — ' + c.bySeverity.P0 + ' P0 · ' + c.bySeverity.P1 + ' P1 · ' + c.bySeverity.P2 + ' P2');
    process.exit(0);
  } else if (args.index) {
    if (args.write) writeIndex();
    else process.stdout.write(reg.index() + '\n');
    process.exit(0);
  } else if (args.validate) {
    const res = reg.validate();
    if (res.ok) { console.log('[qa:bugs] register OK — ' + res.bugs.length + ' bug file(s), no violations'); process.exit(0); }
    console.error('[qa:bugs] REGISTER INVALID — ' + res.errors.length + ' violation(s):');
    for (const e of res.errors) console.error('  - ' + e);
    process.exit(2);
  } else {
    console.error('usage: node scripts/qa/bugs.mjs --new --title "..." --surface <' + SURFACES.join('|') + '> [--severity P0|P1|P2] [--lane <name>]');
    console.error('       node scripts/qa/bugs.mjs --list [--status open] [--surface x] [--severity P0] [--json]');
    console.error('       node scripts/qa/bugs.mjs --set <fingerprint> [--status fixed --fix <sha>] [--lane x] [--verdict "..."]');
    console.error('       node scripts/qa/bugs.mjs --index [--write]');
    console.error('       node scripts/qa/bugs.mjs --validate');
    process.exit(1);
  }
}
