/* node test/sprite-sit-facing.test.js — A SIT FRAME MUST FACE THE WAY ITS NAME SAYS (2026-08-17).

   Found by the recliner side-seat lane. Until then nothing in the game ever showed a seated body in
   PROFILE — a couch sitter is seen from behind and a desk sitter faces north — so `sit_west` /
   `sit_east` were effectively unrendered art, and two of the shipped sets were wrong:
     · grimreaper   — sit_west was a copy of the EAST drawing (both frames faced right).
     · endoskeleton — sit_west and sit_east held each other's drawing.
   On the recliner that is a body sitting backwards in its own chair, and Andrew caught both by eye
   in one pass. Sprite sets arrive from outside this repo, so the next import can reintroduce it.

   Two independent checks, because neither alone is enough — the first pass of this audit only did
   (1) and endoskeleton sailed through it, since a SWAP is still a perfect mirrored pair:
     1. PAIR: sit_west must be further from sit_east as-is than it is when mirrored. A duplicated
        frame fails this.
     2. FACING: in a seated side profile the thighs and shins reach out the way the body faces, so
        the ink centroid of the lower body sits toward the facing side of the head's. A swap fails
        this. Sets whose seated silhouette genuinely has no reach (a capybara is a rump with feet
        tucked under) land near zero and are exempted BY NAME — a new name there wants human eyes,
        not a wider tolerance. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'frontend', 'assets', 'sprites');
/* Seated silhouettes with no forward reach — the metric cannot read them and must not pretend to.
   Verified by eye at 9x: both frames face the way their name says. */
const NO_REACH = new Set(['capybara']);
const REACH_MIN = 1.2;   // |dx| below this is silhouette noise, not a facing

(async () => {
  const { decodePNG } = await import('../scripts/lib/png.mjs');

  const load = (p) => {
    const { width: w, height: h, channels: ch, pixels } = decodePNG(fs.readFileSync(p));
    const alpha = i => (ch === 4 ? pixels[i * ch + 3] : 255);
    const lum = i => {
      const a = alpha(i) / 255;
      return a * (0.299 * pixels[i * ch] + 0.587 * pixels[i * ch + (ch > 2 ? 1 : 0)] + 0.114 * pixels[i * ch + (ch > 2 ? 2 : 0)]);
    };
    return { w, h, alpha, lum };
  };
  const pairDiff = (A_, B_, mirror) => {
    if (A_.w !== B_.w || A_.h !== B_.h) return 999;
    let s = 0;
    for (let y = 0; y < A_.h; y++) for (let x = 0; x < A_.w; x++) {
      const bx = mirror ? A_.w - 1 - x : x;
      s += Math.abs(A_.lum(y * A_.w + x) - B_.lum(y * B_.w + bx));
    }
    return s / (A_.w * A_.h);
  };
  /* + means the lower body reaches EAST of the head, - means WEST. */
  const reach = (img) => {
    let top = img.h, bot = -1, lo = img.w, hi = -1;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.alpha(y * img.w + x) > 40) {
      if (y < top) top = y; if (y > bot) bot = y; if (x < lo) lo = x; if (x > hi) hi = x;
    }
    if (bot < top) return null;
    const mid = top + (bot - top) * 0.55;   // the hips: under head+torso, over the legs
    const cen = (y0, y1) => {
      let sx = 0, n = 0;
      for (let y = y0; y <= y1; y++) for (let x = lo; x <= hi; x++) if (img.alpha(y * img.w + x) > 40) { sx += x; n++; }
      return n ? sx / n : null;
    };
    const up = cen(top, Math.floor(mid)), dn = cen(Math.ceil(mid), bot);
    return (up == null || dn == null) ? null : dn - up;
  };

  let checked = 0;
  for (const set of fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const wp = path.join(ROOT, set, 'sit_west.png'), ep = path.join(ROOT, set, 'sit_east.png');
    if (!fs.existsSync(wp) || !fs.existsSync(ep)) continue;   // a set with no sit frames falls back to rot — assets.js owns that
    checked++;
    const W = load(wp), E = load(ep);

    A.ok(pairDiff(W, E, false) > pairDiff(W, E, true),
      set + ': sit_west is a genuine west drawing, not a second copy of sit_east (the grimreaper defect)');

    const rw = reach(W), re = reach(E);
    A.ok(rw != null && re != null, set + ': both sit frames carry ink');
    if (NO_REACH.has(set)) continue;
    if (Math.abs(rw) < REACH_MIN && Math.abs(re) < REACH_MIN) {
      A.ok(false, set + ': seated silhouette has no readable facing — eyeball it at 9x, then either fix the art or add it to NO_REACH with the reason');
      continue;
    }
    A.ok(rw < 0, set + ': sit_west faces WEST (lower body reaches west of the head, dx=' + rw.toFixed(2) + ')');
    A.ok(re > 0, set + ': sit_east faces EAST (lower body reaches east of the head, dx=' + re.toFixed(2) + ')');
  }
  A.ok(checked >= 30, 'the whole shipped skin catalog was walked, not a handful (' + checked + ' sets)');

  A.report('sprite-sit-facing');
})();
