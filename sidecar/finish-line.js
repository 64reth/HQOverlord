/* sidecar/finish-line.js — immutable task-completion doctrine.

   Agent identity/purpose/manual are Commander-editable and may be old on autonomous surfaces. The host's
   execution contract cannot live only there. runOnce appends this compact block at the final prompt seam for
   every real task, after the editable identity and against the live tool grant. It grants no authority; it tells
   the model how relentlessly to use the authority it already has, and where it must stop honestly. */
'use strict';

const MARKER = '## FINISH THE JOB';

function block(opts) {
  opts = opts || {};
  const tools = new Set((Array.isArray(opts.tools) ? opts.tools : []).map(x => String(x || '').replace(/_/g, '.')));
  const lines = [
    MARKER,
    'Keep working until the requested result is actually complete and verified. The deliverable is the real result backed by tool output, not a plan, a promise, a workaround for the Commander to assemble, or a description of what you would do.',
    'Use tools whenever they materially improve correctness or completeness. If a tool returns empty, partial, stale, or failed output, inspect the exact failure and try a different query, arguments, strategy, or tool before giving up. Never repeat an identical failing call blindly.'
  ];
  if (tools.has('tool.search')) {
    lines.push('Before claiming a capability is missing, use tool.search to discover deferred tools and alternate routes that the live station has granted. A tool not shown in the first row may still be available through search.');
  }
  if (tools.has('browser.login')) {
    lines.push('When a website genuinely requires authentication and the Commander is watching, use browser.login: it opens the station\'s visible, dedicated Chrome window for the Commander to sign in themselves, then returns you to the authenticated headless session. Do not replace that first-class path with command-line or remote-debugging setup instructions.');
  }
  lines.push(
    'Act on the obvious safe interpretation instead of asking how to begin. Ask the Commander only for irreducible human input or a decision that cannot be retrieved and would materially change the action; credentials, MFA, and explicit consent stay with them.',
    'Exhaust safe, authorized, in-scope alternatives before reporting a blocker. Never bypass consent, widen scope, expose secrets, or control the Commander\'s personal browser/profile without the specific authority the harness provides.',
    'Before finishing, verify that every requested requirement is satisfied and report only what real execution proved. If the real path remains blocked after alternatives are exhausted, state the exact blocker and what you tried. Never fabricate output or success.'
  );
  return lines.join('\n');
}

function append(system, opts) {
  const base = String(system || '');
  opts = opts || {};
  if (!opts.isTask || opts.internal || base.indexOf(MARKER) >= 0) return base;
  const doctrine = block(opts);
  return base + (base.trim() ? '\n\n' : '') + doctrine;
}

module.exports = { MARKER, block, append };
