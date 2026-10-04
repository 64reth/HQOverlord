// Run against an isolated dev/seed.js station; uses no inference or account credentials.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';

const profile = mkdtempSync(join(tmpdir(), 'tier-catalog-live-'));
const { proc } = launchChrome({ cdpPort: 19311, profileDir: profile });
let cdp;
try {
  cdp = await connectCDP(19311);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const diagnostics = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:18792' });
  for (let i = 0; i < 50; i++) {
    if (await evalJS(cdp, "typeof StationUI !== 'undefined' && typeof Harness !== 'undefined'").catch(() => false)) break;
    await sleep(200);
  }
  await evalJS(cdp, "StationUI.openTerm('settings', 'models'); true");
  await sleep(1500);
  const picked = await evalJS(cdp, `(() => {
    const s = document.querySelector('#tm-reasoning');
    const option = [...s.options].find(o => o.value && !/unverified|not in catalog/.test(o.textContent));
    if (!option) throw new Error('live catalogue did not load');
    for (const tier of ['reasoning', 'balanced', 'fast']) {
      const select = document.querySelector('#tm-' + tier);
      select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return option.value;
  })()`);
  await evalJS(cdp, "StationUI.closeTerm('settings'); StationUI.openTerm('settings', 'models'); true");
  await sleep(1500);
  const reopened = await evalJS(cdp, `['reasoning', 'balanced', 'fast'].map(tier => {
    const s = document.querySelector('#tm-' + tier);
    return { tier, value: s.value, text: s.selectedOptions[0].textContent, duplicates: [...s.options].filter(o => o.value === s.value).length };
  })`);
  for (const row of reopened) {
    assert.equal(row.value, picked); assert.equal(row.duplicates, 1);
    assert.doesNotMatch(row.text, /not in catalog|unverified/);
  }
  assert.deepEqual(diagnostics.exceptions, []);
  console.log(JSON.stringify({ reopened, diagnostics }, null, 2));
} finally {
  if (cdp) { try { await cdp.send('Browser.close'); } catch (_) {} cdp.ws.close(); }
  if (proc.exitCode === null) { const exit = new Promise(resolve => proc.once('exit', resolve)); proc.kill(); await Promise.race([exit, sleep(3000)]); }
}
