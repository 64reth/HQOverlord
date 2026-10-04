#!/usr/bin/env node
/*
 * release-ritual.mjs — the ordered release-cut driver. Runs the practiced sequence with a HARD
 * STOP between irreversible steps, and NEVER pushes.
 *
 *   node scripts/release-ritual.mjs --next patch            # or --version 0.10.8
 *   node scripts/release-ritual.mjs --next patch --dry-run  # print the plan, mutate nothing
 *   node scripts/release-ritual.mjs --next patch --gates-proven-by gate-fast.log [--gates-proven-by gate-http.log]
 *
 * THE SEQUENCE (this IS the ritual as practiced for v0.10.7 — db64f0064 → 3ba1837cb → 07ea9ebf8):
 *   1. preflight (pre-bump)          release-preflight.mjs — any FAIL row stops here.
 *   2. bump                          `release-bump.mjs <ver> --no-tag` → commit `release: v<ver>`
 *                                    (the five pins + RELEASE_NOTES scaffold, pathspec commit).
 *   3. release notes                 STOP until RELEASE_NOTES.md has no TODO scaffold — the notes are
 *                                    the GitHub release body AND the in-app UPDATE CENTER text.
 *   4. claims re-lock                `claims.mjs --refresh-surface --candidate HEAD` spliced into
 *                                    qa/product-perfect/claims.json, committed as its OWN commit.
 *                                    (The audit reads the COMMIT, never the tree; RELEASE_NOTES.md is
 *                                    in the locked surface, so every bump owes this.)
 *   5. gates                         STOP until a fresh green receipt exists for HEAD. Prints the
 *                                    exact commands. Accepts --gates-proven-by <log> and verifies the
 *                                    log's LAST LINE is the runner's green summary (never the exit
 *                                    code), and that the log is newer than HEAD's commit. Writes
 *                                    .dogfood/gate-receipts/<sha>.<gate>.json. (MISTAKES.md "Gate
 *                                    order": gate AFTER the bump, BEFORE the tag — v0.2.0 + v0.2.1.)
 *   6. preflight (post-bump)         the same checklist, now with pins == target, notes real, claims
 *                                    current, and gate-at-HEAD a HARD requirement.
 *   7. tag                           `git tag v<ver>` on HEAD (= the re-lock commit — tag-after-stamp
 *                                    is what made the v0.6.5 train pass first try). On a lane
 *                                    (--allow-lane) this step instead STOPS with the merge command:
 *                                    the tag goes on TRUNK after the merge.
 *   8. STOP                          prints `git push origin HEAD v<ver>` and exactly what the push
 *                                    triggers. The ritual never pushes.
 *
 * RE-RUNNABLE BY DESIGN. Every step has an isDone() probe against the repo, so after a STOP you fix
 * the thing and run the SAME command again; completed steps are skipped, the next one runs. There
 * is no --resume flag to forget.
 *
 * HOUSE PATTERN: pure core (`runRitual`) + injected io. test/release-ritual.test.js
 * drives the step ordering and every stop condition with a fake io.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  GATE_RECEIPT_DIR, SEMVER_RE, TRUNK, bumpSemver, parseGateLog,
  readVersionPins, renderChecklist, runPreflight, stripBom
} from './release-preflight.mjs';

export const STEPS = Object.freeze(['preflight', 'bump', 'notes', 'relock', 'gates', 'preflight-post', 'tag', 'push-stop']);

function gitOut(io, args) {
  const r = io.exec('git', args);
  return r && r.status === 0 ? String(r.stdout || '').trim() : null;
}

function resolveTarget(ctx, io) {
  if (ctx.version) return ctx.version;
  const pins = readVersionPins(io);
  const current = pins[2].value;
  if (!ctx.next) throw new Error('pass --version X.Y.Z or --next patch|minor|major');
  if (!current || !SEMVER_RE.test(String(current))) throw new Error('cannot derive --next: tauri.conf.json version unreadable');
  // If the pins ALREADY sit one step above what --next would compute from them, the bump happened on a
  // previous run of this same command: keep the target stable across re-runs by inspecting HEAD's subject.
  const subject = gitOut(io, ['log', '-1', '--format=%s']) || '';
  const m = /^release: v(\d+\.\d+\.\d+\S*)$/.exec(subject);
  if (m && m[1] === current) return current;
  const relock = /^qa\(claims\): re-lock the release surface for v(\d+\.\d+\.\d+\S*)$/.exec(subject);
  if (relock && relock[1] === current) return current;
  return bumpSemver(current, ctx.next);
}

/* ───────────────────────────── step probes ───────────────────────────── */

export function bumpDone(io, target) {
  const pins = readVersionPins(io);
  return pins.every(p => String(p.value) === target);
}

export function notesDone(io, target) {
  const t = io.readText('RELEASE_NOTES.md');
  if (t == null) return false;
  const header = (/^#\s*StarNet\s+v?(\S+)/m.exec(stripBom(t)) || [])[1];
  return header === target && !/TODO: summarize/.test(t);
}

export function relockDone(io) {
  const r = io.exec('node', ['scripts/qa/product-perfect/claims.mjs']);
  const first = r ? stripBom(String(r.stdout || '')).split(/\r?\n/).filter(Boolean)[0] || '' : '';
  return !!(r && r.status === 0 && /^PASS\b/.test(first));
}

export function gateReceipt(io, head, gate) {
  const t = io.readText(GATE_RECEIPT_DIR + '/' + head + '.' + gate + '.json');
  if (t == null) return null;
  try { const r = JSON.parse(stripBom(t)); return (r && r.commit === head && r.green === true) ? r : null; } catch { return null; }
}

/** Verify a gate log: last line must be the green summary AND the log must be newer than HEAD's commit. */
export function verifyGateLog(io, logPath, head) {
  const text = io.readText(logPath);
  if (text == null) return { ok: false, reason: 'log not readable: ' + logPath };
  const parsed = parseGateLog(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason + ' — last line was: "' + parsed.lastLine.slice(0, 120) + '"' };
  const st = io.stat(logPath);
  const commitTs = Number(gitOut(io, ['log', '-1', '--format=%ct', head]) || 0) * 1000;
  if (st && commitTs && st.mtimeMs < commitTs) return { ok: false, reason: 'log predates HEAD (' + head.slice(0, 9) + ') — it proves an older tree. Re-run the gate on THIS commit.' };
  return { ok: true, gate: parsed.gate, steps: parsed.steps, lastLine: parsed.lastLine };
}

/* ───────────────────────────── the driver ───────────────────────────── */

/**
 * ctx: { version?, next?, dryRun, allowLane, gatesProvenBy: string[], keyFile, requireHttp }
 * io : preflight io + writeText(rel, text), mkdirp(rel), chdirRoot (cwd already root)
 * Returns { target, steps:[{id, status:'done'|'skipped'|'ran'|'planned'|'stopped', lines:[]}], stoppedAt, exitCode }.
 */
export function runRitual(ctx, io) {
  const out = { target: null, steps: [], stoppedAt: null, exitCode: 0, log: [] };
  const step = (id) => { const s = { id, status: 'planned', lines: [] }; out.steps.push(s); return s; };
  const stop = (s, why, how) => { s.status = 'stopped'; s.lines.push('STOP — ' + why); if (how) for (const h of [].concat(how)) s.lines.push('  ' + h); out.stoppedAt = s.id; out.exitCode = 2; };
  const dry = !!ctx.dryRun;

  let target;
  try { target = resolveTarget(ctx, io); } catch (e) { const s = step('preflight'); stop(s, e.message); return out; }
  out.target = target;
  const tag = 'v' + target;
  const branch = gitOut(io, ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
  const onLane = branch !== TRUNK;
  const baseCtx = { version: target, allowLane: ctx.allowLane, keyFile: ctx.keyFile };

  // 1. preflight (pre-bump) — skipped once the bump has landed (its pins row would only say so).
  {
    const s = step('preflight');
    if (bumpDone(io, target)) { s.status = 'skipped'; s.lines.push('bump already landed — the post-bump preflight (step 6) covers this'); }
    else {
      const pf = runPreflight(Object.assign({ phase: 'pre-bump' }, baseCtx), io);
      s.lines.push(...renderChecklist(pf).split('\n'));
      s.status = 'ran';
      if (!pf.ok && dry) s.lines.push('would STOP here: ' + pf.fails + ' hard preflight row(s) red (dry-run continues to show the full plan)');
      else if (!pf.ok) { stop(s, pf.fails + ' hard preflight row(s) red', 'fix every [FAIL] row above (each names its remediation), then run this same command again'); return out; }
    }
  }

  // 2. bump
  {
    const s = step('bump');
    const cmd = 'node scripts/release-bump.mjs ' + target + ' --no-tag';
    if (bumpDone(io, target)) { s.status = 'done'; s.lines.push('pins already = ' + target + ' (release commit exists)'); }
    else if (dry) { s.lines.push('would run: ' + cmd, 'commits `release: ' + tag + '` (package.json, package-lock root, tauri.conf.json, Cargo.toml, Cargo.lock, RELEASE_NOTES scaffold) by pathspec; NO tag yet — the tag goes on the re-lock commit'); }
    else {
      s.lines.push('running: ' + cmd);
      const r = io.exec('node', ['scripts/release-bump.mjs', target, '--no-tag']);
      s.lines.push(...String((r && (r.stdout + r.stderr)) || '').split(/\r?\n/).filter(Boolean).map(l => '  ' + l));
      if (!r || r.status !== 0) { stop(s, 'release-bump exited ' + (r ? r.status : 'spawn-failure'), 'read its message above; nothing was tagged'); return out; }
      if (!bumpDone(io, target)) { stop(s, 'release-bump finished but the five pins do not all read ' + target, 'inspect `git show --stat HEAD`'); return out; }
      s.status = 'ran';
    }
  }

  // 3. release notes — hard stop until real
  {
    const s = step('notes');
    if (notesDone(io, target)) { s.status = 'done'; s.lines.push('RELEASE_NOTES.md has a real # StarNet ' + tag + ' entry (no TODO)'); }
    else if (dry && !bumpDone(io, target)) { s.lines.push('would STOP until RELEASE_NOTES.md is written for ' + tag + ' (replace the TODO scaffold; `git add RELEASE_NOTES.md && git commit --amend --no-edit`)'); }
    else { stop(s, 'RELEASE_NOTES.md is still the TODO scaffold for ' + tag, ['write the user-facing notes (GitHub release body + in-app UPDATE CENTER text)', 'git add RELEASE_NOTES.md && git commit --amend --no-edit    (amend the `release: ' + tag + '` commit — it must be HEAD)', 'then run this same command again']); return out; }
  }

  // 4. claims re-lock — its own commit, generated from the COMMIT
  {
    const s = step('relock');
    const subject = gitOut(io, ['log', '-1', '--format=%s']) || '';
    const already = /^qa\(claims\): re-lock the release surface for v/.test(subject) && relockDone(io);
    if (already) { s.status = 'done'; s.lines.push('claims lock current for HEAD (' + subject + ')'); }
    else if (dry) { s.lines.push('would run: SHA=$(git rev-parse HEAD); node scripts/qa/product-perfect/claims.mjs --refresh-surface --candidate $SHA → splice as .releaseSurface into qa/product-perfect/claims.json', 'would commit: git commit -m "qa(claims): re-lock the release surface for ' + tag + '" -- qa/product-perfect/claims.json', '(reads the COMMIT, never the tree — RELEASE_NOTES.md is in the locked surface so every bump owes this)'); }
    else if (relockDone(io)) { s.status = 'done'; s.lines.push('claims lock already current for HEAD — no re-lock needed'); }
    else {
      const head = gitOut(io, ['rev-parse', 'HEAD']);
      const r = io.exec('node', ['scripts/qa/product-perfect/claims.mjs', '--refresh-surface', '--candidate', head]);
      if (!r || r.status !== 0) { stop(s, '--refresh-surface failed: ' + String((r && (r.stderr || r.stdout)) || '').split(/\r?\n/)[0], 'node scripts/qa/product-perfect/claims.mjs --refresh-surface --candidate ' + head); return out; }
      let surface, ledger;
      try { surface = JSON.parse(stripBom(r.stdout)); ledger = JSON.parse(stripBom(io.readText('qa/product-perfect/claims.json'))); }
      catch (e) { stop(s, 'could not parse surface/ledger JSON: ' + e.message); return out; }
      ledger.releaseSurface = surface;
      io.writeText('qa/product-perfect/claims.json', JSON.stringify(ledger, null, 2) + '\n');
      const c = io.exec('git', ['commit', '-m', 'qa(claims): re-lock the release surface for ' + tag, '--', 'qa/product-perfect/claims.json']);
      if (!c || c.status !== 0) { stop(s, 'git commit of the re-lock failed: ' + String((c && (c.stderr || c.stdout)) || '').split(/\r?\n/)[0]); return out; }
      if (!relockDone(io)) { stop(s, 're-lock committed but claims.mjs still not PASS', 'node scripts/qa/product-perfect/claims.mjs   (read its reasons; a changed path-set needs a re-audit, not a re-lock)'); return out; }
      s.status = 'ran'; s.lines.push('committed: qa(claims): re-lock the release surface for ' + tag);
    }
  }

  // 5. gates — refuse to continue without a fresh green receipt for HEAD
  {
    const s = step('gates');
    const head = gitOut(io, ['rev-parse', 'HEAD']) || '';
    // ingest any --gates-proven-by logs first
    for (const logPath of (ctx.gatesProvenBy || [])) {
      if (dry) { s.lines.push('would verify log ' + logPath + ' (last line must be the green summary; mtime newer than HEAD) and write ' + GATE_RECEIPT_DIR + '/<sha>.<gate>.json'); continue; }
      const v = verifyGateLog(io, logPath, head);
      if (!v.ok) { s.lines.push('REJECTED ' + logPath + ': ' + v.reason); continue; }
      io.mkdirp(GATE_RECEIPT_DIR);
      io.writeText(GATE_RECEIPT_DIR + '/' + head + '.' + v.gate + '.json', JSON.stringify({ commit: head, gate: v.gate, green: true, steps: v.steps, lastLine: v.lastLine, log: logPath, at: new Date(io.now()).toISOString() }, null, 2) + '\n');
      s.lines.push('accepted ' + logPath + ' → ' + v.gate + ' gate green (' + v.steps + ' steps) at ' + head.slice(0, 9));
    }
    const fast = head ? gateReceipt(io, head, 'fast') : null;
    const http = head ? gateReceipt(io, head, 'http') : null;
    if (fast && (http || !ctx.requireHttp)) { s.status = 'done'; s.lines.push('test:fast green at HEAD (' + fast.steps + ' steps, ' + fast.at + ')' + (http ? ' · test:http green (' + http.steps + ' steps)' : ' · test:http: no receipt (required only if sidecar/ship/route code changed — pass --require-http to insist)')); }
    else if (dry && !bumpDone(io, target)) { s.lines.push('would STOP until a green receipt for the bumped HEAD exists:', '  npm run test:fast 2>&1 | tee gate-fast.log', '  npm run test:http 2>&1 | tee gate-http.log      (when sidecar/ship/route code changed)', '  node scripts/release-ritual.mjs --version ' + target + ' --gates-proven-by gate-fast.log --gates-proven-by gate-http.log'); }
    else {
      stop(s, 'no fresh green gate receipt for HEAD ' + head.slice(0, 9) + (fast ? ' (test:http required by --require-http and missing)' : ''), [
        'the gate runs AFTER the bump and BEFORE the tag (MISTAKES.md "Gate order" — v0.2.0 + v0.2.1 were burned by skipping it):',
        '  npm run test:fast 2>&1 | tee gate-fast.log',
        '  npm run test:http 2>&1 | tee gate-http.log      (when sidecar/ship/route code changed)',
        'then: node scripts/release-ritual.mjs --version ' + target + (ctx.allowLane ? ' --allow-lane' : '') + ' --gates-proven-by gate-fast.log [--gates-proven-by gate-http.log]',
        'the ritual reads the LOG\'s last line ("run-fast-tests: OK — N step(s) green"), never the exit code.'
      ]);
      return out;
    }
  }

  // 6. preflight (post-bump) — everything hard now
  {
    const s = step('preflight-post');
    if (dry && !bumpDone(io, target)) { s.lines.push('would re-run release-preflight --phase post-bump: pins == ' + target + ', notes real, claims current, gate receipt at HEAD all HARD'); }
    else {
      const pf = runPreflight(Object.assign({ phase: 'post-bump' }, baseCtx), io);
      s.lines.push(...renderChecklist(pf).split('\n'));
      s.status = 'ran';
      if (!pf.ok) { stop(s, pf.fails + ' hard post-bump row(s) red', 'fix them, then run this same command again (completed steps are skipped)'); return out; }
    }
  }

  // 7. tag (or, on a lane, STOP for the merge)
  {
    const s = step('tag');
    const head = gitOut(io, ['rev-parse', 'HEAD']) || '';
    const tagAt = gitOut(io, ['rev-list', '-n', '1', tag]);
    if (onLane) {
      const how = [
        'from the integration tree (Desktop/gen, ' + TRUNK + '):',
        '  git merge ' + branch + ' -m "merge: cut ' + tag + '"',
        '  node scripts/release-ritual.mjs --version ' + target + '     (re-runs post-bump preflight on the merge commit, then tags it)',
        'note: the merge commit is a NEW commit — its gate receipt must be earned there too (fast-forward merges keep the lane receipt valid).'
      ];
      if (dry) s.lines.push('would STOP: on lane "' + branch + '" — the tag belongs on trunk, after the merge (v0.10.7 pattern)', ...how.map(h => '  ' + h));
      else { stop(s, 'on lane "' + branch + '" — the tag belongs on trunk, after the merge (v0.10.7 pattern)', how); out.exitCode = 3; return out; }
    }
    if (onLane && dry) { /* plan shown above */ }
    else if (tagAt && tagAt === head) { s.status = 'done'; s.lines.push(tag + ' already at HEAD ' + head.slice(0, 9)); }
    else if (tagAt) { stop(s, tag + ' already exists at ' + tagAt.slice(0, 9) + ' ≠ HEAD', 'a spent version: --next patch'); return out; }
    else if (dry) { s.lines.push('would run: git tag ' + tag + '     (on HEAD = the re-lock commit; tag-after-stamp)'); }
    else {
      const r = io.exec('git', ['tag', tag]);
      if (!r || r.status !== 0) { stop(s, 'git tag failed: ' + String((r && r.stderr) || '').trim()); return out; }
      s.status = 'ran'; s.lines.push('tagged ' + tag + ' at ' + head.slice(0, 9) + ' (local only)');
    }
  }

  // 8. STOP — print the push and what it triggers. Never push.
  {
    const s = step('push-stop');
    s.status = dry ? 'planned' : 'stopped';
    s.lines.push(
      'NOT PUSHED. The ritual never pushes. When you are ready, paste:',
      '  git push origin HEAD ' + tag,
      'What that does:',
      '  - the `v*` tag push FIRES .github/workflows/release-train.yml: gate → build (win/mac legs, signing REQUIRED) → assemble latest.json → stage a DRAFT on the releases repo.',
      '  - a DRAFT is invisible to users; nothing ships until you click Publish (runbook §1.8).',
      '  - the stage-draft job uploads with --clobber: re-pushing or force-moving this tag OVERWRITES the staged installer/.sig for ' + tag + '. Never force-move a tag CI may have built from — bump a patch instead (runbook §2.3).',
      'Still owed AFTER the push, BEFORE Publish (all RELEASE BLOCKERS, runbook §1.6–1.7a):',
      '  - watch the 4 train jobs go green; review the draft asset list (one latest.json; every updater artifact has a .sig).',
      '  - T0 clean-install proof: Actions → t0-clean-install-proof → tag=' + tag,
      '  - G1 packaged-lifecycle: Actions → g1-packaged-lifecycle → tag=' + tag,
      'After Publish: npm run release:verify-host -- --expect-version ' + target + '   then the canary (runbook §1.9–1.10).'
    );
    out.stoppedAt = out.stoppedAt || 'push-stop';
  }
  return out;
}

export function renderRitual(result, ctx) {
  const lines = [];
  lines.push('== release-ritual · target ' + (result.target ? 'v' + result.target : '(unresolved)') + (ctx && ctx.dryRun ? ' · DRY RUN (nothing mutated)' : '') + ' ==');
  result.steps.forEach((s, i) => {
    lines.push('');
    lines.push((i + 1) + '. ' + s.id.toUpperCase() + ' [' + s.status + ']');
    for (const l of s.lines) lines.push('   ' + l);
  });
  const remaining = STEPS.filter(id => !result.steps.some(s => s.id === id));
  if (remaining.length) { lines.push(''); lines.push('not reached: ' + remaining.join(' → ')); }
  return lines.join('\n');
}

/* ───────────────────────────── io shell + CLI ───────────────────────────── */

export function makeRitualIo(root) {
  const abs = (p) => (/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(p) ? p : resolve(root, p));
  return {
    root,
    readText(p) { try { return readFileSync(abs(p), 'utf8'); } catch { return null; } },
    writeText(p, t) { writeFileSync(abs(p), t); },
    mkdirp(p) { mkdirSync(abs(p), { recursive: true }); },
    exists(p) { try { return existsSync(abs(p)); } catch { return false; } },
    listDir(p) { try { return readdirSync(abs(p)); } catch { return null; } },
    stat(p) { try { const s = statSync(abs(p)); return { mtimeMs: s.mtimeMs, size: s.size }; } catch { return null; } },
    exec(cmd, args) {
      try {
        const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && cmd === 'gh' });
        return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
      } catch (e) { return { status: null, stdout: '', stderr: '', error: e }; }
    },
    now() { return Date.now(); }
  };
}

export function parseRitualArgs(argv) {
  const out = { version: null, next: null, dryRun: false, allowLane: false, gatesProvenBy: [], requireHttp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]);
    if (a.startsWith('--version')) out.version = val();
    else if (a.startsWith('--next')) out.next = val();
    else if (a.startsWith('--gates-proven-by')) out.gatesProvenBy.push(val());
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--allow-lane') out.allowLane = true;
    else if (a === '--require-http') out.requireHttp = true;
  }
  return out;
}

const INVOKED_DIRECTLY = (() => { try { return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; } catch { return false; } })();

if (INVOKED_DIRECTLY) {
  const ROOT = process.env.STARNET_PREFLIGHT_ROOT ? resolve(process.env.STARNET_PREFLIGHT_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const a = parseRitualArgs(process.argv.slice(2));
  const ctx = Object.assign(a, { keyFile: process.env.STARNET_UPDATER_KEY_FILE || join(homedir(), '.tauri', 'starnet-updater.key') });
  const result = runRitual(ctx, makeRitualIo(ROOT));
  process.stdout.write(renderRitual(result, ctx) + '\n');
  process.exit(result.exitCode);
}
