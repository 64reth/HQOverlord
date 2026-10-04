'use strict';
const A = require('./_assert.js');
const Reach = require('../scripts/browser-reach-measure.js');

(async () => {
  A.throws(() => Reach.assertAuthorized('https://outside.example/path', ['https://owned.example']),
    /not in the exact-origin authorization list/, 'an unlisted origin is refused');
  A.eq(Reach.assertAuthorized('https://owned.example/path', ['https://owned.example']).pathname, '/path',
    'an exact authorized origin is accepted');
  A.throws(() => Reach.assertAuthorized('https://sub.owned.example/', ['https://owned.example']),
    /not in/, 'authorization does not silently include subdomains');

  const calls = [];
  const driver = {
    async navigate(url) { calls.push(['navigate', url]); },
    lastResponse() { return { status: 200 }; },
    async challengeStatus() { return { challenged: false, signal: '' }; },
    async testEval() { return { url: 'https://owned.example/final', ua: 'Mozilla/5.0 Chrome/130.0.0.0', webdriver: false, language: 'en-US', hints: { brands: [{ brand: 'Chromium', version: '130' }] }, plugins: 5, chrome: true, geometry: [1440, 900, 1440, 900, 1440, 900] }; },
    async getText() { return 'Owned fixture content'; }
  };
  const receipt = await Reach.measureWithDriver('https://owned.example/start', driver,
    { authorizedOrigins: ['https://owned.example'] });
  A.eq(calls[0][1], 'https://owned.example/start', 'the authorized URL is navigated');
  A.eq(receipt.reached, true, 'ordinary non-empty content is recorded as reached');
  A.eq(receipt.challenged, false, 'ordinary content is not recorded as challenged');
  A.eq(receipt.textChars, 21, 'only aggregate text length is retained');
  A.eq(receipt.identity.headlessProductToken, false, 'headless product-token exposure is measured');
  A.eq(receipt.identity.headlessClientHints, false, 'Client-Hints headless exposure is measured independently');
  A.eq(receipt.identity.webdriver, false, 'webdriver exposure is measured');
  A.eq(receipt.identity.fullBrowserSurface, true, 'reduced headless-shell browser surfaces are measured');
  A.eq(receipt.identity.geometryCoherent, true, 'screen and window geometry coherence is measured');
  A.eq(receipt.authorizationEscaped, false, 'a same-origin final URL stays inside the authorization receipt');

  driver.challengeStatus = async () => ({ challenged: true, signal: 'title' });
  driver.getText = async () => { throw new Error('challenge content must not be treated as reached text'); };
  const blocked = await Reach.measureWithDriver('https://owned.example/challenge', driver,
    { authorizedOrigins: ['https://owned.example'] });
  A.eq(blocked.reached, false, 'a verification wall is not counted as reach');
  A.eq(blocked.challengeSignal, 'title', 'the challenge signal is retained without copying wall content');
  A.eq(blocked.textChars, 0, 'challenge text is excluded from the reach receipt');

  driver.challengeStatus = async () => ({ challenged: false, signal: null });
  driver.getText = async () => { throw new Error('off-authorization content must not be read'); };
  driver.testEval = async () => ({ url: 'https://redirect.example/final', ua: 'Chrome/130', webdriver: false, language: 'en-US' });
  const escaped = await Reach.measureWithDriver('https://owned.example/redirect', driver,
    { authorizedOrigins: ['https://owned.example'] });
  A.eq(escaped.reached, false, 'content after a cross-origin redirect is never counted as authorized reach');
  A.eq(escaped.authorizationEscaped, true, 'a cross-origin redirect is explicit in the receipt');

  A.report('browser.reach-measure');
})().catch(error => { console.log('FAIL: browser.reach-measure threw -- ' + (error && error.stack || error)); process.exit(1); });
