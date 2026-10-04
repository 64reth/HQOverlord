/* sidecar/domain-task.js — pure policy for a bounded, direct-domain inspection.

   A request such as "check example.com and read its docs" is not an open-ended web-research
   assignment. The exact host is the subject. If that host provably does not resolve, searching
   dozens of engines, archives and spelling variants cannot complete the requested read; it only
   hides a likely typo behind minutes of activity.

   This module identifies only the narrow case: one explicit public hostname, direct inspect/read
   language, and no request to locate alternatives/history/the correct URL. The host then uses the
   policy at three independent seams: prompt guidance, delegation restraint, and terminal evidence.
   False negatives merely keep the ordinary research path; false positives are avoided by the
   explicit exclusion vocabulary below. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.domainTask = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HOST_RE = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63})(?::\d+)?(?:[\/?#][^\s]*)?/ig;
  // Bare dotted words are admitted only when their final label is an assigned country-code suffix or a
  // well-known generic public suffix. This is intentionally conservative: a false negative keeps ordinary
  // research behavior, while treating Cargo.toml as a host can terminate real work early.
  const COUNTRY_SUFFIXES = 'ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw'.split(' ');
  const GENERIC_SUFFIXES = 'aero app art asia biz blog cloud club com coop dev digital edu email gov info int live mil mobi museum name net news online org pro shop site store tech travel xyz'.split(' ');
  // `.invalid` is the one deliberate non-public exception: it is the deterministic way to exercise terminal
  // NXDOMAIN handling without a live domain. Other special-use labels collide with common files (`.env.example`,
  // `widget.test`) and therefore stay on the conservative non-domain path.
  const PUBLIC_SUFFIXES = new Set(COUNTRY_SUFFIXES.concat(GENERIC_SUFFIXES, ['invalid']));
  const DIRECT_RE = /\b(check|check out|visit|open|read|inspect|browse|look at|review)\b|\b(docs?|documentation|website|site)\b/i;
  const EXPANSIVE_RE = /\b(find|locate|discover)\s+(?:the\s+)?(?:correct|right|official|new|current)\b|\b(alternatives?|similar sites?|where (?:it|the site) moved|domain history|archives?|wayback|compare|across the web)\b|\bsearch\s+(?:the\s+)?web\s+for\b/i;
  const WORKER_MAX_ITERS = 3;
  const WORKER_MAX_TOOLS = 3;
  const WORKER_MAX_MS = 45000;

  function normalizeHost(host) {
    return String(host || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
  }

  function hostsOf(text) {
    const found = [];
    const seen = new Set();
    const src = String(text || '');
    let m;
    HOST_RE.lastIndex = 0;
    while ((m = HOST_RE.exec(src)) !== null) {
      const host = normalizeHost(m[1]);
      const explicitUrl = /^https?:\/\//i.test(m[0]);
      const preceding = m.index > 0 ? src[m.index - 1] : '';
      const suffix = host.slice(host.lastIndexOf('.') + 1);
      if (!explicitUrl && (preceding === '@' || preceding === '/' || preceding === '\\')) continue;
      // Uppercase bare identifiers are overwhelmingly repository filenames (README.md, LICENSE.md). URLs
      // remain case-insensitive when explicit; for a bare ambiguous token, declining classification is safer.
      if (!explicitUrl && m[1] !== m[1].toLowerCase()) continue;
      if (!explicitUrl && !PUBLIC_SUFFIXES.has(suffix)) continue;
      if (!host || seen.has(host)) continue;
      seen.add(host); found.push(host);
    }
    return found;
  }

  function classify(text) {
    const src = String(text || '').trim();
    const hosts = hostsOf(src);
    if (hosts.length !== 1 || !DIRECT_RE.test(src) || EXPANSIVE_RE.test(src)) return null;
    return {
      kind: 'direct-domain', host: hosts[0],
      workerMaxIters: WORKER_MAX_ITERS, workerMaxTools: WORKER_MAX_TOOLS, workerMaxMs: WORKER_MAX_MS
    };
  }

  function urlHost(raw) {
    try { return normalizeHost(new URL(String(raw || '')).hostname); } catch (_) { return ''; }
  }

  function isTargetFetch(call, policy) {
    if (!call || !policy || policy.kind !== 'direct-domain') return false;
    const name = String(call.name || '').replace(/_/g, '.');
    if (name !== 'web.fetch') return false;
    return urlHost(call.args && call.args.url) === normalizeHost(policy.host);
  }

  function isDomainMissing(result) {
    const summary = String((result && result.summary) || '').toLowerCase();
    const content = String((result && result.content) || '').toLowerCase();
    return summary === 'domain not found'
      || /\bdomain\b[^\n]{0,160}\bdoes not resolve\b/.test(content)
      || /\bnxdomain\b/.test(content);
  }

  function prompt(policy) {
    if (!policy) return '';
    return '[DIRECT DOMAIN CHECK — HOST POLICY] The Commander named one exact host: ' + policy.host + '. '
      + 'Check that host yourself with web_fetch; do not delegate this single-host lookup. If the fetch reports '
      + 'that the domain does not resolve / NXDOMAIN, that is terminal evidence for this request: make no more '
      + 'web, DNS, archive, WHOIS, certificate, or spelling-variant calls. Report the unavailable host and ask '
      + 'for the corrected URL. Only search for alternatives when the Commander explicitly asked you to find them.';
  }

  function stopControl(policy) {
    return {
      stopTools: true,
      reason: 'target domain does not resolve',
      prompt: '<terminal_domain>The exact requested host ' + policy.host + ' does not resolve. This is terminal '
        + 'evidence for the direct-domain request. Do not call or propose any more tools. Briefly report that the '
        + 'site/docs cannot be read, say the URL is likely mistyped or unavailable, and ask for the corrected URL.</terminal_domain>'
    };
  }

  return {
    classify, hostsOf, normalizeHost, isTargetFetch, isDomainMissing, prompt, stopControl,
    WORKER_MAX_ITERS, WORKER_MAX_TOOLS, WORKER_MAX_MS
  };
});
