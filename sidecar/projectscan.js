/* sidecar/projectscan.js — the bounded, DETERMINISTIC project SNAPSHOT scan (autonomy layer, NS-5b, consumes NS-5).

   When the night focus is a blessed project root and reach ≥ sandbox, the act beat should READ the user's project
   before proposing, so it EXTENDS real work instead of guessing. That read is done by HARNESS CODE here — a bounded,
   deterministic scan (git status/log/diff + a TODO/FIXME grep + the top-level tree) — NOT by model tool-improv. The
   result is injected as a PROJECT SNAPSHOT block into the propose/do directives (bounded exactly like contextpack).

   THE TRUST BOUNDARY (load-bearing): scan() consults the injected `isBlessed(root)` guard FIRST and runs NOTHING for
   an un-blessed root — no exec, no readdir. It reads through the harness's own path (git run with cwd=root), which
   the pathtrust guard already permits for blessed roots; it NEVER weakens that guard and NEVER blesses a new root.
   An autonomous run cannot reach this for a path the Commander didn't already trust.

   DETERMINISM SPLIT: the git/fs IO is INJECTED (exec, fsp) so this module is pure orchestration + bounded text
   composition — lint-determinism clean (no Date.now / rng / raw child_process), node-testable with a fake exec. */
'use strict';

const DEFAULT_MAX_CHARS = 2000;      // hard ceiling on the whole snapshot text (keeps the propose prompt bounded)
const MAX_STATUS_LINES = 24;
const MAX_LOG_LINES = 12;
const MAX_TODO_LINES = 24;
const MAX_TREE_ENTRIES = 30;
const LINE_MAX = 160;
const EXEC_TIMEOUT_MS = 6000;
const EXEC_MAX_BUFFER = 1 << 20;     // 1 MB cap on any single git output (never read an unbounded blob)

const str = (v) => (v == null ? '' : String(v));

// collapse + clamp one line.
function oneLine(s, max) {
  const t = str(s).replace(/[\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const m = max || LINE_MAX;
  return t.length > m ? (t.slice(0, m - 1) + '…') : t;
}
// take the first N non-empty lines of a blob, each clamped.
function capLines(blob, n, lineMax) {
  const out = [];
  for (const raw of str(blob).split(/\r?\n/)) {
    const l = oneLine(raw, lineMax);
    if (!l) continue;
    out.push(l);
    if (out.length >= n) break;
  }
  return out;
}

function makeProjectScan(deps) {
  deps = deps || {};
  const exec = typeof deps.exec === 'function' ? deps.exec : null;
  const fsp = deps.fsp || null;
  const isBlessed = typeof deps.isBlessed === 'function' ? deps.isBlessed : (() => false);
  const defMax = Number.isFinite(deps.maxChars) ? deps.maxChars : DEFAULT_MAX_CHARS;

  // run a git subcommand at cwd=root; return stdout (bounded) or '' on any failure. Never throws.
  async function git(root, args) {
    if (!exec) return '';
    try {
      const r = await exec('git', ['-C', root].concat(args), { cwd: root, timeoutMs: EXEC_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER });
      return str(r && r.stdout);
    } catch (_) { return ''; }
  }

  // compose the bounded snapshot text from labeled sections (whole-section drop past the cap, then hard clamp).
  function compose(root, sections, maxChars) {
    const cap = Number.isFinite(maxChars) ? maxChars : defMax;
    const head = 'PROJECT SNAPSHOT — ' + oneLine(root, 120) + ' (read by the station, not guessed):';
    const out = [head];
    let used = head.length;
    for (const sec of sections) {
      if (!sec || !sec.lines || !sec.lines.length) continue;
      const body = [sec.label + ':'].concat(sec.lines.map(l => '  ' + l)).join('\n');
      const add = 2 + body.length;
      if (used + add > cap) break;
      out.push(body);
      used += add;
    }
    const text = out.join('\n\n');
    return text.length > cap ? text.slice(0, cap) : text;
  }

  /* scan(rootReal, opts) — the bounded project read. Returns { ok, reason?, isGit, text, sections }.
       opts: { sinceMs, maxChars }. A non-blessed root → { ok:false, reason:'not-blessed', text:'' } with NO IO. */
  async function scan(rootReal, opts) {
    opts = opts || {};
    const root = str(rootReal);
    if (!root || !isBlessed(root)) return { ok: false, reason: 'not-blessed', isGit: false, text: '', sections: [] };
    const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : defMax;

    const isGit = /true/.test(await git(root, ['rev-parse', '--is-inside-work-tree']));
    const sections = [];

    if (isGit) {
      const status = capLines(await git(root, ['status', '--porcelain']), MAX_STATUS_LINES, LINE_MAX);
      if (status.length) sections.push({ label: 'Uncommitted changes (working tree)', lines: status });

      const logArgs = ['log', '--oneline', '-n', String(MAX_LOG_LINES)];
      if (Number.isFinite(opts.sinceMs) && opts.sinceMs > 0) logArgs.push('--since=' + Math.floor(opts.sinceMs / 1000));
      const log = capLines(await git(root, logArgs), MAX_LOG_LINES, LINE_MAX);
      if (log.length) sections.push({ label: 'Recent commits', lines: log });

      const diff = capLines(await git(root, ['diff', '--stat']), 12, LINE_MAX);
      if (diff.length) sections.push({ label: 'Diff since last commit', lines: diff });

      // TODO/FIXME grep — git grep respects .gitignore + is bounded; -I skips binaries.
      const todo = capLines(await git(root, ['grep', '-nI', '-E', 'TODO|FIXME|XXX|HACK']), MAX_TODO_LINES, LINE_MAX);
      if (todo.length) sections.push({ label: 'TODO / FIXME markers', lines: todo });
    } else {
      // non-git: a bounded top-level tree only (a deep TODO walk is deliberately NOT done here — no repo to bound it).
      let entries = [];
      try {
        if (fsp && typeof fsp.readdir === 'function') {
          const list = await fsp.readdir(root, { withFileTypes: true });
          entries = (Array.isArray(list) ? list : [])
            .filter(e => e && e.name && !/^\.(git|env)/.test(e.name))
            .slice(0, MAX_TREE_ENTRIES)
            .map(e => (e.isDirectory && e.isDirectory() ? e.name + '/' : e.name));
        }
      } catch (_) { entries = []; }
      if (entries.length) sections.push({ label: 'Top-level files', lines: entries });
    }

    const text = compose(root, sections, maxChars);
    return { ok: true, isGit, text, sections };
  }

  return { scan, _compose: compose };
}

module.exports = { makeProjectScan, DEFAULT_MAX_CHARS };
