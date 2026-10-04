'use strict';
const GOOGLE = 'https://accounts.google.com';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
function publicAccount(entry) {
  const a = entry && entry.account;
  if (!a || a.issuer !== GOOGLE || typeof a.subject !== 'string' || !a.subject ||
      typeof a.email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+$/.test(a.email) || a.email.length > 320 || !Number.isFinite(a.verifiedAt)) return null;
  return { issuer: a.issuer, subject: a.subject.slice(0, 255), email: a.email, verifiedAt: a.verifiedAt };
}
async function readGoogleAccount({ authorizationServer, tokenEndpoint, accessToken, fetchImpl, now, timeoutMs = 4000 }) {
  if (authorizationServer !== GOOGLE || tokenEndpoint !== 'https://oauth2.googleapis.com/token' || !accessToken) return null;
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); }), (async () => {
      const res = await fetchImpl(USERINFO, { headers: { Authorization: 'Bearer ' + accessToken }, redirect: 'error', signal: controller.signal });
      if (!res.ok) return null;
      let text;
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader(), chunks = []; let size = 0;
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > 8192) { await reader.cancel(); return null; }
            chunks.push(Buffer.from(part.value));
          }
          text = Buffer.concat(chunks).toString('utf8');
        } finally { reader.releaseLock(); }
      } else {
        text = await res.text();
        if (text.length > 8192) return null;
      }
      const j = JSON.parse(text);
      if (j.email_verified !== true) return null;
      return publicAccount({ account: { issuer: GOOGLE, subject: j.sub, email: j.email, verifiedAt: now } });
    })()]);
  } catch (_) { return null; }  // identity failure never turns a usable connector into a failed sign-in
  finally { clearTimeout(timer); }
}
module.exports = { readGoogleAccount, publicAccount };
