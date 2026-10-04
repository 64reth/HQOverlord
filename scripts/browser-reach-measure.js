#!/usr/bin/env node
'use strict';

/*
 * Reach measurement is deliberately an observation tool, not a challenge solver.
 * It accepts only entry URLs whose exact origin the operator authorizes, records
 * redirect escape honestly, keeps aggregate outcomes, and never clicks or submits.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _internals: Browser } = require('../sidecar/tools/builtin/browser.js');

function normalizeOrigins(values) {
  const raw = Array.isArray(values) ? values : String(values || '').split(',');
  return new Set(raw.filter(Boolean).map(value => new URL(String(value).trim()).origin));
}

function assertAuthorized(rawUrl, authorizedOrigins) {
  const target = new URL(String(rawUrl));
  const allowed = normalizeOrigins(authorizedOrigins);
  if (!allowed.has(target.origin)) {
    throw new Error('Reach measurement refused: ' + target.origin +
      ' is not in the exact-origin authorization list.');
  }
  return target;
}

async function measureWithDriver(rawUrl, driver, options) {
  const target = assertAuthorized(rawUrl, options && options.authorizedOrigins);
  const started = Date.now();
  await driver.navigate(target.href);

  const response = driver.lastResponse();
  const challenge = await driver.challengeStatus();
  const observed = await driver.testEval(
    `(async()=>{let hints=null;try{hints=navigator.userAgentData?await navigator.userAgentData.getHighEntropyValues(['uaFullVersion','fullVersionList']):null;}catch(e){}
      return{url:location.href,ua:navigator.userAgent,webdriver:navigator.webdriver,language:navigator.language,
        hints,plugins:navigator.plugins.length,chrome:!!globalThis.chrome,
        geometry:[screen.width,screen.height,innerWidth,innerHeight,outerWidth,outerHeight]};})()`
  );
  const finalOrigin = observed && observed.url ? new URL(observed.url).origin : null;
  const finalOriginAuthorized = !!finalOrigin && normalizeOrigins(options && options.authorizedOrigins).has(finalOrigin);
  const text = challenge.challenged || !finalOriginAuthorized ? '' : await driver.getText();
  const status = response && Number(response.status) || null;

  return {
    requestedOrigin: target.origin,
    finalOrigin,
    finalOriginAuthorized,
    authorizationEscaped: !finalOriginAuthorized,
    status,
    reached: finalOriginAuthorized && !challenge.challenged && status !== null && status >= 200 && status < 400 && text.trim().length > 0,
    challenged: challenge.challenged === true,
    challengeSignal: challenge.signal || null,
    textChars: text.length,
    identity: {
      headlessProductToken: /HeadlessChrome/i.test(observed && observed.ua || ''),
      headlessClientHints: /HeadlessChrome/i.test(JSON.stringify(observed && observed.hints || {})),
      webdriver: observed ? observed.webdriver === true : null,
      languagePresent: !!(observed && observed.language),
      fullBrowserSurface: observed ? observed.chrome === true && Number(observed.plugins) > 0 : null,
      geometryCoherent: observed && Array.isArray(observed.geometry)
        ? observed.geometry[0] >= observed.geometry[4] && observed.geometry[1] >= observed.geometry[5] &&
          observed.geometry[4] >= observed.geometry[2] && observed.geometry[5] >= observed.geometry[3]
        : null
    },
    elapsedMs: Date.now() - started
  };
}

async function measureReach(rawUrl, options) {
  options = options || {};
  assertAuthorized(rawUrl, options.authorizedOrigins);
  const found = options.chrome || Browser.findChrome();
  if (!found) throw new Error('Reach measurement requires an installed Chromium browser.');
  const chrome = typeof found === 'string' ? found : found.path;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-reach-'));
  const driver = Browser.makeCdpDriver({
    chrome,
    forceHeadless: true,
    syntheticInputOnly: true,
    cdpPort: 0,
    profileDir,
    timeoutMs: options.timeoutMs || 20000
  });
  try {
    return await measureWithDriver(rawUrl, driver, options);
  } finally {
    try { await driver.close(); } catch (_) {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function cliOptions(argv, env) {
  const options = { authorizedOrigins: String(env.STARNET_REACH_AUTHORIZED_ORIGINS || '').split(',').filter(Boolean) };
  let url = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') url = argv[++i] || '';
    else if (argv[i] === '--authorized-origin') options.authorizedOrigins.push(argv[++i] || '');
    else throw new Error('Unknown argument: ' + argv[i]);
  }
  if (!url) throw new Error('Usage: node scripts/browser-reach-measure.js --url <url> --authorized-origin <exact-origin>');
  return { url, options };
}

if (require.main === module) {
  let parsed;
  try { parsed = cliOptions(process.argv.slice(2), process.env); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
  if (parsed) measureReach(parsed.url, parsed.options)
    .then(receipt => console.log(JSON.stringify(receipt, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { normalizeOrigins, assertAuthorized, measureWithDriver, measureReach, cliOptions };
