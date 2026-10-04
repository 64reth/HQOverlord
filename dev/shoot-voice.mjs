// dev/shoot-voice.mjs — tight, repeatable crops of the LOCAL LIVE voice console.
//
// Why this exists: the voice panel is a body-child overlay floating over the game canvas, so the
// normal `npm run shoot` sweep never captures it, and a full-page screenshot is 95% canvas. This
// boots a SEEDED sidecar, opens a live voice session against Chrome's fake mic, and captures a
// clipped PNG of just the panel — per skin, per state, per theme.
//
// Usage (pick free ports if another session is running):
//   node dev/shoot-voice.mjs                                  # default sweep
//   RAW=1 node dev/shoot-voice.mjs                            # untouched live session + telemetry proof
//   SKINS=console,handset,scope,monolith node dev/shoot-voice.mjs
//   THEMES=amber,green,blue,purple,red STATES=hearing,offline node dev/shoot-voice.mjs
//   PORT=8971 CDPP=9371 OUT=.voiceshots node dev/shoot-voice.mjs
//
// TRAP (learned the hard way): finish animations before capture, NEVER pause them. pause() freezes
// CSS *transitions* mid-interpolation, so the frame records a colour the UI never rests on — it
// produced a gold orb ring on a blue-theme panel that looked like a real theming bug and wasn't.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const { sleep, connectCDP, evalJS, collectDiagnostics } = await import(`file:///${join(REPO, 'scripts/lib/cdp.mjs').replace(/\\/g, '/')}`);
const { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } =
  await import(`file:///${join(REPO, 'scripts/lib/seed.mjs').replace(/\\/g, '/')}`);

const OUT = process.env.OUT || join(REPO, '.voiceshots');
const PORT = process.env.PORT || '8941';
const CDP_PORT = Number(process.env.CDPP || 9341);
const APP = `http://127.0.0.1:${PORT}/`;
mkdirSync(OUT, { recursive: true });

// CLIP=<selector> tightens the crop onto one part (CLIP='#lv-barge' SCALE=6 to judge the key's
// face) — a 34px control inside a 210px module is unreadable in a panel-sized frame.
const CLIP_SEL = process.env.CLIP || '#live-voice-panel';
const SHOT_SCALE = Number(process.env.SCALE || 2);
const CLIP_PAD = Number(process.env.PAD || 24);

async function measure(cdp) {
  return evalJS(cdp, `(() => {
    const p = document.getElementById('live-voice-panel');
    if (!p || p.hidden) return null;
    const t = p.matches(${JSON.stringify(CLIP_SEL)}) ? p : p.querySelector(${JSON.stringify(CLIP_SEL)});
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`);
}

// `box` may be pre-measured: pushLevel() writes the meter every ~46ms off the live mic, so ANY
// round trip between stamping a demo level and the shutter is a chance for the real (near silent)
// room to overwrite it. Measure first, stamp last, capture immediately.
async function shotPanel(cdp, name, box) {
  if (box === undefined) box = await measure(cdp);
  if (!box) { console.log(`  ${name}: PANEL NOT VISIBLE`); return false; }
  const pad = CLIP_PAD;
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
                 width: box.width + pad * 2, height: box.height + pad * 2, scale: SHOT_SCALE };
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(`  ${name}.png  (${Math.round(box.width)}x${Math.round(box.height)})`);
  return true;
}

if (!(await isUp(APP))) {
  console.log('booting seeded sidecar on', PORT);
  materializeSeedWorkspace(join(OUT, '_seed'));
  bootSeededSidecar({ port: PORT, scratchDir: join(OUT, '_seed') });
  if (!(await waitUp(APP))) throw new Error('sidecar never came up');
}
console.log('sidecar up');

const bin = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
].find(existsSync) || 'chrome';
const proc = spawn(bin, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio',
  // the fake device emits a tone, which drives the REAL vad/rms path — that is what proves the
  // scope bars are microphone-driven and not a decorative animation
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--remote-debugging-port=${CDP_PORT}`, '--window-size=1440,900',
  `--user-data-dir=${join(OUT, '_profile')}`, 'about:blank',
], { stdio: 'ignore' });

const cdp = await connectCDP(CDP_PORT);
const diag = collectDiagnostics(cdp);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: APP });
await sleep(2500);
const ready = await waitDevReady(cdp, evalJS, { tries: 30, url: APP });
console.log('in-game:', ready);
console.log('start:', await evalJS(cdp, `(async () => { try { await VoiceLive.start(false); return 'ok'; } catch (e) { return 'ERR ' + e.message; } })()`));
await sleep(2800);

if (process.env.RAW) {
  // Untouched live session: prove the scope is driven by the REAL mic, not a decorative loop.
  const read = () => evalJS(cdp, `JSON.stringify({
    amp: getComputedStyle(document.getElementById('live-voice-panel')).getPropertyValue('--lv-amp'),
    state: document.getElementById('live-voice-panel').dataset.state,
    skin: document.getElementById('live-voice-panel').dataset.skin,
    bars: [...document.querySelectorAll('#lv-wave i')].map(b => b.textContent).join(''),
    heard: document.getElementById('lv-heard').textContent,
    model: document.getElementById('lv-model').textContent,
    route: document.getElementById('lv-route').textContent
  })`);
  for (let i = 0; i < 4; i++) { console.log('live', i, await read()); await sleep(700); }
  await shotPanel(cdp, 'RAW-live');
  proc.kill();
  process.exit(0);
}

const SKINS = (process.env.SKINS || 'console').split(',');
const THEMES = (process.env.THEMES || 'amber').split(',');
const STATES = (process.env.STATES || 'listening,hearing,thinking,speaking,offline').split(',');

for (const skin of SKINS) {
  // SKINS= drives the candidate attribute directly. It used to call VoiceLive.setSkin(), but that
  // switcher is scaffolding for CHOOSING a design and gets deleted once one is chosen — stamping
  // data-skin keeps this sweep usable for the next round without re-adding a live API.
  await evalJS(cdp, `(() => {
    const p = document.getElementById('live-voice-panel');
    if (typeof VoiceLive.setSkin === 'function') return VoiceLive.setSkin(${JSON.stringify(skin)});
    p.dataset.skin = ${JSON.stringify(skin)};
    return p.dataset.skin;
  })()`);
  for (const theme of THEMES) {
    await evalJS(cdp, `(() => {
      document.body.className = document.body.className.replace(/\\btheme-\\S+/g, '').trim();
      ${theme === 'amber' ? '' : `document.body.classList.add('theme-${theme}');`}
      return document.body.className;
    })()`);
    await sleep(200);
    for (const st of STATES) {
      await evalJS(cdp, `(() => {
        const S = ${JSON.stringify(st)};
        const p = document.getElementById('live-voice-panel');
        p.dataset.state = S;
        document.getElementById('lv-state').textContent = S.toUpperCase();
        const amp = S === 'hearing' ? 0.72 : S === 'listening' ? 0.2 : 0.05;
        p.style.setProperty('--lv-amp', String(amp));
        p.style.setProperty('--lv-dl', S === 'thinking' ? '64%' : '0%');
        document.getElementById('lv-heard').textContent =
          S === 'offline' ? 'Microphone is offline.' : 'what is the status of the harness backend';
        const ag = document.getElementById('lv-agent');
        ag.textContent = S === 'thinking' ? 'Working on it.'
          : S === 'speaking' ? 'Harness backend is still running. Two other tasks are queued behind it.' : '';
        ag.classList.toggle('on', !!ag.textContent);
        document.getElementById('lv-route').textContent = 'LOCAL SPEECH · OPENAI · SCOUT';
        const task = document.getElementById('lv-task');
        task.textContent = 'WORKING · Harness backend';
        task.className = 'lv-task busy';
        const err = document.getElementById('lv-error');
        err.hidden = S !== 'offline';
        err.textContent = 'Microphone access is blocked. Allow it for this local page, then try again.';
        document.getElementById('lv-retry').hidden = S !== 'offline';
        // finish, never pause — see the TRAP note at the top of this file
        try { document.getAnimations().forEach(a => { try { a.finish(); } catch (_) {} }); } catch (_) {}
        return p.dataset.state;
      })()`);
      await sleep(180);
      const box = await measure(cdp);
      // THE METER IS NEVER FAKED. Earlier drafts wrote demo glyphs into the columns and a demo
      // --lv-amp, then lost a race with pushLevel() (which writes every ~46ms off the live mic) and
      // photographed the real near-silent room while captioning it 0.72 — a frame that lies about
      // the one thing this module exists to show. So the surrounding TEXT is staged and the level
      // is not: wait for a real frame with something in it, then shoot immediately.
      const lively = await evalJS(cdp, `(async () => {
        const read = () => [...document.querySelectorAll('#lv-wave i')].map(b => b.textContent).join('');
        for (let i = 0; i < 40; i++) {
          const s = read();
          if ([...s].filter(c => c !== '▁').length >= 4) return s;
          await new Promise(r => setTimeout(r, 60));
        }
        return read();
      })()`);
      await shotPanel(cdp, `${skin}-${theme}-${st}`, box);
      console.log(`    level (real): ${lively}`);
    }
  }
}

// The level IS the control: with no icon left, the only way to cut in is the meter itself, so a
// capture that merely LOOKS right proves nothing. Assert the button really wraps the bars, really
// has the click handler, and is really the size the eye thinks it is.
console.log('barge control:', await evalJS(cdp, `JSON.stringify((() => {
  const b = document.getElementById('lv-barge');
  if (!b) return { ok: false, why: 'no #lv-barge' };
  const r = b.getBoundingClientRect();
  return {
    ok: b.tagName === 'BUTTON' && !!b.onclick && !!b.querySelector('#lv-wave i'),
    tag: b.tagName, cls: b.className, wired: !!b.onclick,
    wrapsBars: b.querySelectorAll('#lv-wave i').length,
    label: b.getAttribute('aria-label'),
    w: Math.round(r.width), h: Math.round(r.height)
  };
})())`));

// NO WHITE HTML CONTROLS law: those three computed values ARE the bug's signature.
console.log('OS-paint offenders:', await evalJS(cdp, `JSON.stringify((() => {
  const bad = [];
  document.querySelectorAll('#live-voice-panel button, #live-voice-panel input, #live-voice-panel select').forEach(el => {
    const cs = getComputedStyle(el);
    if (/^rgb\\(255, 255, 255\\)$|^rgb\\(239, 239, 239\\)$/.test(cs.backgroundColor)
        || /^rgb\\(118, 118, 118\\)$/.test(cs.borderTopColor)
        || /Arial/i.test(cs.fontFamily)) bad.push((el.id || el.className) + ' bg=' + cs.backgroundColor + ' bd=' + cs.borderTopColor + ' ff=' + cs.fontFamily);
  });
  return bad;
})())`));
console.log('console errors:', JSON.stringify(diag.consoleMsgs.slice(0, 8)));
console.log('exceptions:', JSON.stringify(diag.exceptions.slice(0, 5)));

proc.kill();
process.exit(0);
