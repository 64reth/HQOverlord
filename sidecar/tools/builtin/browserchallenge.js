/* sidecar/tools/builtin/browserchallenge.js ? one truthful definition of a browser challenge.

   A verification interstitial is not page content. Both the automatic web reader and the
   interactive browser use this pure classifier so they cannot disagree about whether a page was
   actually reached. Keep this deliberately conservative: false positives hide legitimate content,
   so body-text matching is limited to the short, terse pages real challenge systems return. */
'use strict';

const CHALLENGE_TITLES = [
  'access denied', 'access to this page has been denied', 'blocked', 'bot detected',
  'verification required', 'please verify', 'are you a robot', 'captcha', 'cloudflare',
  'ddos protection', 'checking your browser', 'just a moment', 'attention required'
];

const CHALLENGE_TEXT = /you.?ve been blocked|access( to this site)? (is |has been )?denied|verify (that )?you.?re? (a )?human|complete the (following |security )?(challenge|check)|unusual traffic|confirm .{0,30}(human|not a robot)|enable javascript and cookies to continue|network security/i;

function looksChallenged(title) {
  const low = String(title || '').toLowerCase();
  return CHALLENGE_TITLES.some(pattern => low.indexOf(pattern) >= 0);
}

function looksBlockedText(text) {
  const value = String(text || '').trim();
  return value.length > 0 && value.length < 1200 && CHALLENGE_TEXT.test(value.slice(0, 600));
}

function detectChallenge(page) {
  page = page || {};
  if (looksChallenged(page.title)) return { challenged: true, signal: 'title' };
  if (looksBlockedText(page.text)) return { challenged: true, signal: 'text' };
  return { challenged: false, signal: null };
}

module.exports = { CHALLENGE_TITLES, CHALLENGE_TEXT, looksChallenged, looksBlockedText, detectChallenge };
