'use strict';

/* brand-wordmark-mask.test.js — the topbar brand mark is a CSS mask over a traced SVG.
 *
 * That recipe has exactly two silent failure modes, and BOTH of them happened while building it
 * (2026-08-05). Neither shows up in computed style, and neither is visible to any harness that
 * renders the SVG inline, so nothing but this file stands between them and a shipped blank logo:
 *
 *   1. A DOUBLE HYPHEN INSIDE THE SVG'S XML COMMENT. XML forbids `--` in a comment, so the file
 *      does not parse, so the mask resource fails, so the masked element renders NOTHING. The
 *      generator stamped its own CLI flag ("--preset=mosaic") into the provenance comment and the
 *      wordmark vanished from the topbar. Measured, not inferred: lit fraction went 0.129 -> 0.
 *      The size-ladder harness never saw it because inlining the markup into HTML uses HTML's
 *      lenient comment parsing; only the mask/<img> path is strict XML.
 *   2. VIEWBOX / ASPECT-RATIO DRIFT. .logo-img has no intrinsic size (it is a <span>), so its width
 *      comes from a hardcoded `aspect-ratio` in style.css. Retracing at a different field height
 *      changes the SVG's viewBox, and if the CSS is not updated with it the mark is stretched and
 *      #logo-anchor reserves the wrong seat.
 *
 * It also pins the z-order the mark depends on: it must sit UNDER both CRT glass layers (so the
 * beam runs across it) while staying ABOVE #screen-game (so it still covers floating windows and
 * app/logoclip.js is still the thing that clips it).
 */

const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'frontend', 'assets', 'brand', 'starnet-wordmark.svg');
const svg = fs.readFileSync(svgPath, 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend', 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');

// ---- 1. the SVG is well-formed enough to survive being loaded as a mask ---------------------
const comments = svg.match(/<!--[\s\S]*?-->/g) || [];
comments.forEach((c, i) => {
  A.ok(!c.slice(4, -3).includes('--'),
    `wordmark SVG comment #${i + 1} has no "--" inside it (XML forbids it; the mask silently fails and the mark renders invisible)`);
});
A.ok(/^\s*<svg[\s>]/.test(svg), 'wordmark SVG starts with a single <svg> root');
A.eq((svg.match(/<svg[\s>]/g) || []).length, 1, 'wordmark SVG has exactly one <svg> element');
A.ok(!/<\?xml-stylesheet|<!DOCTYPE/i.test(svg), 'wordmark SVG carries no stylesheet PI or doctype a mask loader could choke on');

const paths = svg.match(/<path\b[^>]*\bd="([^"]+)"/g) || [];
A.ok(paths.length >= 1, 'wordmark SVG contains at least one <path> with a d attribute');
const d = (svg.match(/<path\b[^>]*\bd="([^"]+)"/) || [])[1] || '';
A.ok(d.length > 200, 'the wordmark path carries real geometry, not a stub');
A.ok(/fill="currentColor"/.test(svg),
  'the path fills with currentColor so the same asset works inline; the mask path only reads its alpha');

// ---- 2. the CSS aspect-ratio still matches the SVG's viewBox --------------------------------
const vb = (svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number);
A.ok(vb.length === 2 && vb[0] > 0 && vb[1] > 0, 'wordmark SVG declares a numeric viewBox');

const rule = (css.match(/\.logo-img\s*\{[^}]*\}/) || [])[0] || '';
A.ok(rule, 'style.css still carries a .logo-img rule');
const ar = (rule.match(/aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/) || []).slice(1).map(Number);
A.ok(ar.length === 2, '.logo-img declares an explicit aspect-ratio (a masked <span> has no intrinsic size)');
A.ok(Math.abs((ar[0] / ar[1]) - (vb[0] / vb[1])) < 0.002,
  `.logo-img aspect-ratio ${ar[0]}/${ar[1]} matches the SVG viewBox ${vb[0]}x${vb[1]} (retrace changed the viewBox? copy it into style.css)`);

A.ok(/mask:\s*url\(\.\.\/assets\/brand\/starnet-wordmark\.svg\)/.test(rule),
  '.logo-img masks with starnet-wordmark.svg');
A.ok(/-webkit-mask:\s*url\(/.test(rule), '.logo-img keeps the -webkit-mask prefix alongside the standard property');
A.ok(/background-color:\s*var\(--ph\)/.test(rule),
  '.logo-img paints var(--ph) so the mark re-tints with the theme instead of being a fixed colour');
A.ok(!/(drop-shadow|text-shadow|filter:\s*[^;]*(blur|brightness))/.test(rule),
  '.logo-img carries no CSS glow/brightness filter (removed per Andrew; it fuzzed the mark)');

// ---- 3. the markup is a masked <span>, not an <img> -----------------------------------------
const markEl = (html.match(/<[a-z]+[^>]*class="logo-img"[^>]*>/) || [])[0] || '';
A.ok(markEl, 'index.html still mounts an element with class="logo-img"');
A.ok(/^<span/.test(markEl),
  'the mark is a <span> — an <img> cannot take var(--ph), and it was the img that had no size until it decoded');
A.ok(/aria-label="STARNET"/.test(markEl) && /role="img"/.test(markEl),
  'the masked span still names itself STARNET for assistive tech (a background image has no alt text)');

// ---- 4. z-order: under the CRT glass, over the screen ---------------------------------------
const logoRule = (css.match(/#logo\s*\{[^}]*\}/) || [])[0] || '';
const logoZ = Number((logoRule.match(/z-index:\s*(\d+)/) || [])[1]);
const glassZ = (css.match(/body::(?:before|after)\s*\{[^}]*z-index:\s*(\d+)/g) || [])
  .map(s => Number((s.match(/z-index:\s*(\d+)/) || [])[1]))
  .filter(n => Number.isFinite(n));
A.ok(Number.isFinite(logoZ), '#logo declares a z-index');
A.ok(glassZ.length === 2, 'both CRT glass layers (body::before vignette, body::after scanlines) declare a z-index');
A.ok(logoZ < Math.min(...glassZ),
  `#logo z-index ${logoZ} sits UNDER both glass layers ${glassZ.join('/')} so the beam runs across the mark`);
A.ok(logoZ > 10,
  `#logo z-index ${logoZ} still outranks #screen-game (z-index:10), which is what makes app/logoclip.js necessary`);
A.report('brand-wordmark-mask.test');
