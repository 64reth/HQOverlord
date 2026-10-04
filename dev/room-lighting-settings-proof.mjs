import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchChrome, connectCDP, evalJS, sleep, capture } from '../scripts/lib/cdp.mjs';
const out = '.worldshots/room-lighting-settings';
mkdirSync(out, { recursive: true });
let proc, cdp;
const results = [];
try {
  ({ proc } = launchChrome({ cdpPort: 9381, profileDir: out + '/profile' }));
  cdp = await connectCDP(9381);
  await cdp.send('Page.enable');
  const load = async () => {
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:9197/' });
    for (let i = 0; i < 100; i++) {
      if (await evalJS(cdp, "typeof StationUI !== 'undefined' && typeof World !== 'undefined' && !!World.stationDoc()")) return;
      await sleep(150);
    }
    throw Error('Station did not load');
  };
  const open = async () => {
    await evalJS(cdp, "StationUI.openTerm('settings', 'appearance'); true");
    for (let i = 0; i < 60; i++) {
      if (await evalJS(cdp, "!!document.querySelector('#set-lighting button')")) { await sleep(600); return; }
      await sleep(100);
    }
    throw Error('Lighting controls did not open');
  };
  const read = () => evalJS(cdp, `(() => {
    const geo = WorldModel.create(World.stationDoc()).projectGeometry();
    const bake = StationBake.bake(geo), c = bake.lightCv.getContext('2d');
    let total = 0, count = 0;
    for (const r of geo.allRects) {
      for (let y = r.y1 * 12 + 3; y < (r.y2 + 1) * 12; y += 6) {
        for (let x = r.x1 * 12 + 3; x < (r.x2 + 1) * 12; x += 6) {
          total += 1 - c.getImageData(x, y, 1, 1).data[3] / 255; count++;
        }
      }
    }
    const buttons = [...document.querySelectorAll('#set-lighting button')];
    return { ambient: StationBake.LIGHT.ambient, glow: World.crt.glow,
      illumination: total / count, lamps: bake.lamps,
      selected: buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.lighting),
      buttons: buttons.map(b => ({ text: b.textContent, bg: getComputedStyle(b).backgroundColor, border: getComputedStyle(b).borderColor })) };
  })()`);
  await load();
  await open();
  for (const [level, ambient] of [['low', .82], ['medium', .72], ['high', .62]]) {
    await evalJS(cdp, `document.querySelector('[data-lighting="${level}"]').click(); true`);
    const state = await read();
    assert.equal(state.ambient, ambient);
    assert.equal(state.glow, .13);
    assert.deepEqual(state.selected, [level]);
    assert.equal(state.buttons.length, 3);
    assert.ok(state.buttons.every(b => !['rgb(255, 255, 255)', 'rgb(239, 239, 239)'].includes(b.bg) && b.border !== 'rgb(118, 118, 118)'));
    if (results.length) {
      assert.ok(state.illumination > results.at(-1).illumination + .02, 'visible room illumination increases');
      assert.deepEqual(state.lamps, results[0].lamps, 'light placement and radius remain identical');
    }
    results.push({ level, ...state });
    await capture(cdp, out, level + '-settings');
    await load();
    await open();
    const restored = await read();
    assert.equal(restored.ambient, ambient);
    assert.deepEqual(restored.selected, [level]);
  }
  // A real keyboard event activates the focused native button.
  assert.equal(await evalJS(cdp, 'document.querySelector(\'[data-lighting="medium"]\').focus(); document.activeElement.dataset.lighting'), 'medium');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.deepEqual((await read()).selected, ['medium']);
  await evalJS(cdp, 'document.querySelector(\'[data-lighting="low"]\').click(); true');
  await load(); await open();
  assert.deepEqual((await read()).selected, ['low']);
  const receipt = { results, reloadPersistence: true, keyboard: true, restoredLow: true };
  writeFileSync(out + '/proof.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { cdp?.ws.close(); proc?.kill(); }
