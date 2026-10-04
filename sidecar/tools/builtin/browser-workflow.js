'use strict';

// Derive a read-only client from observed traffic, never from a guessed endpoint. This is
// deliberately metadata-only: browser cookies, authorization headers and bodies are not captured.
const PRIVATE_PARAM = /token|secret|password|passwd|authorization|cookie|session|signature|api.?key|credential|^key$|^code$|^sig$|^auth$/i;
function deriveReadClient(rows) {
  const candidates = [], seen = new Set();
  let skipped = 0;
  for (const row of (Array.isArray(rows) ? rows : []).slice(-200)) {
    if (!row || row.method !== 'GET' || row.failure || !Number.isInteger(row.status) || row.status < 200 || row.status >= 300
      || !['XHR', 'Fetch'].includes(row.type)) continue;
    let url;
    if (String(row.url || '').length > 8192) { skipped++; continue; }
    try { url = new URL(row.url); } catch (_) { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || [...url.searchParams.keys()].some(k => PRIVATE_PARAM.test(k))) { skipped++; continue; }
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const source = [
      '// Observed GET only. Verify the result against the browser before saving as a skill.',
      '// No browser credentials are embedded. Authentication failures require supported setup.',
      'const url = new URL(' + JSON.stringify(url.href) + ');',
      'const response = await fetch(url, { method: "GET", redirect: "error",',
      '  headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });',
      'if (!response.ok) throw new Error("HTTP " + response.status + "; return to the browser or configure supported authentication");',
      'if (!/json/i.test(response.headers.get("content-type") || "")) throw new Error("Expected JSON; verify endpoint in browser");',
      'const reader = response.body.getReader();',
      'const chunks = []; let bytes = 0;',
      'try { for (;;) { const { done, value } = await reader.read(); if (done) break;',
      '  bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) throw new Error("Response exceeds 2 MB; narrow the query"); chunks.push(value);',
      '} } finally { await reader.cancel(); }',
      'const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));',
      'console.log(JSON.stringify(result, null, 2));'
    ].join('\n');
    candidates.push({ url: url.href, method: 'GET', status: row.status, source, verified: false });
    if (candidates.length === 8) break;
  }
  return { candidates, skipped, note: 'Observed request templates, not verified workflows. Run a selected client once, compare its data with the live page, then save the proven procedure with skill.manage. Requests needing credentials may not work browserless. No traffic is executed by this operation.' };
}
module.exports = { deriveReadClient };
