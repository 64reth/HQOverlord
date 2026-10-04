/* sidecar/skills/guard.js - static guard for runtime/external skill packages.

   The scanner is intentionally regex-based and deterministic. It catches
   common prompt-injection, exfiltration, destructive command, persistence,
   and obfuscation patterns before a skill package is trusted.
*/
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).skillGuard = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TRUST = {
    builtin: { safe: 'allow', caution: 'allow', dangerous: 'allow' },
    trusted: { safe: 'allow', caution: 'allow', dangerous: 'block' },
    // Community procedures commonly contain URLs or setup scripts. Those are inspectable cautions,
    // not automatic malware: install them withheld and bind the Commander's approval to exact bytes.
    // High/critical findings remain an outright block.
    community: { safe: 'allow', caution: 'ask', dangerous: 'block' },
    'agent-created': { safe: 'allow', caution: 'allow', dangerous: 'ask' },
    /* THE COMMANDER IS THE APPROVER, SO THEY GET ASK — NOT BLOCK. A skill the human typed into
       the SKILLS panel used to be scanned as 'trusted', whose answer for dangerous content is
       block; with the gate now enforcing verdicts that made a dead end — you write `rm -rf` into
       your own local procedure on purpose, and the only surface that could bless it is the one
       refusing you, with no key anywhere ("sandbox, no gating" cuts against that). 'trusted'
       still means what it says for content that arrives claiming to be vetted by someone else
       (a future hub install), where a dangerous pattern is evidence the claim is false. */
    user: { safe: 'allow', caution: 'allow', dangerous: 'ask' }
  };
  const ORDER = { safe: 0, caution: 1, dangerous: 2 };
  const PATTERNS = [
    [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'env_exfil_curl', 'critical', 'exfiltration', 'curl command interpolating a secret env var'],
    [/wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'env_exfil_wget', 'critical', 'exfiltration', 'wget command interpolating a secret env var'],
    [/fetch\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD|API)/i, 'env_exfil_fetch', 'high', 'exfiltration', 'fetch call mentioning secret material'],
    [/requests\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)/i, 'env_exfil_requests', 'high', 'exfiltration', 'requests call mentioning secret material'],
    [/ignore (all )?(previous|prior|system|developer) instructions/i, 'ignore_instructions', 'high', 'injection', 'instruction override request'],
    [/reveal (the )?(system|developer) prompt/i, 'reveal_prompt', 'high', 'injection', 'prompt disclosure request'],
    [/rm\s+-rf\s+(\/|\$HOME|~|\.)/i, 'rm_rf', 'critical', 'destructive', 'destructive recursive removal'],
    [/Remove-Item\s+.*-Recurse\s+.*-Force/i, 'ps_remove_recurse', 'critical', 'destructive', 'destructive PowerShell removal'],
    [/>+\s*~\/\.(bashrc|zshrc|profile|powershell)/i, 'shell_profile_persist', 'medium', 'persistence', 'shell profile persistence'],
    [/\b(base64|fromCharCode|eval|Invoke-Expression)\b/i, 'obfuscation_eval', 'medium', 'obfuscation', 'obfuscation or dynamic execution'],
    [/https?:\/\/[^\s`'")]+/i, 'network_url', 'low', 'network', 'embedded network URL']
  ];
  const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

  function str(v) { return v == null ? '' : String(v); }
  function verdictFor(findings) {
    let max = 0;
    for (const f of findings) max = Math.max(max, SEV_RANK[f.severity] || 0);
    if (max >= 3) return 'dangerous';
    if (max >= 1) return 'caution';
    return 'safe';
  }
  function scanText(file, content) {
    const findings = [];
    const lines = str(content).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/.test(line)) {
        findings.push({ patternId: 'invisible_unicode', severity: 'medium', category: 'obfuscation', file, line: i + 1, match: '', description: 'invisible Unicode control character' });
      }
      for (const p of PATTERNS) {
        const m = p[0].exec(line);
        if (m) findings.push({ patternId: p[1], severity: p[2], category: p[3], file, line: i + 1, match: str(m[0]).slice(0, 160), description: p[4] });
      }
    }
    return findings;
  }
  function scanSkillRecord(skill, opts) {
    opts = opts || {};
    const source = opts.source || skill.createdBy || 'agent-created';
    const files = Array.isArray(skill.files) ? skill.files : [];
    let findings = scanText('SKILL.md', str(skill.body) + '\n' + str(skill.setup));
    for (const f of files) findings = findings.concat(scanText(str(f.path || 'support-file'), f.content));
    const verdict = verdictFor(findings);
    return {
      skillName: str(skill.name || skill.id || 'skill'),
      source,
      trustLevel: TRUST[source] ? source : 'community',
      verdict,
      findings,
      summary: findings.length ? (findings.length + ' finding(s), verdict=' + verdict) : 'safe'
    };
  }
  function shouldAllow(scan, opts) {
    opts = opts || {};
    if (!scan) return { allow: true, action: 'allow', reason: 'not scanned' };
    const trust = TRUST[scan.trustLevel] || TRUST.community;
    const action = trust[scan.verdict] || 'block';
    if (action === 'allow') return { allow: true, action, reason: scan.summary || 'safe' };
    if (action === 'ask' && opts.allowAsk !== false) return { allow: true, action, reason: scan.summary || 'requires review' };
    return { allow: false, action, reason: scan.summary || 'blocked by skill guard' };
  }
  /* "take the WORSE of two risk levels" — which failed OPEN on anything it did not recognize. ORDER[unknown]
     is undefined, and `undefined >= n` is FALSE, so an unrecognized level always LOST: worse('Dangerous',
     'safe') returned 'safe', and so did any typo, casing difference, or level a newer scanner emits. An
     unknown risk is the one thing that must never be treated as the safer option — rank it above every known
     level so it wins, and normalize case so a spelling difference is not a downgrade. */
  function rankOf(v) {
    const k = String(v == null ? '' : v).trim().toLowerCase();
    if (!k) return ORDER.safe;
    return Object.prototype.hasOwnProperty.call(ORDER, k) ? ORDER[k] : Infinity;   // unknown = worst
  }
  function worse(a, b) { return rankOf(a) >= rankOf(b) ? a : b; }

  return { scanText, scanSkillRecord, shouldAllow, worse, TRUST };
});
