  /* ============ v46 WORKSTATION KIT (2026-09-02) ============
     The six seats + the workbench rebuilt as one family. What the v45 set lacked was never joinery —
     it was VALUE and LOCAL COLOUR: every slab sat on MAT.steel's dark blue-grey band with a 12px CRT
     on it, so seven different stations read as seven small grey boxes on a grey deck.
       ⛔ THE SLAB IS A BIG PALE PLANE, EDGE TO EDGE. Warm-neutral laminate authored HIGH (top ~L 0.68)
          so the ceiling strip has something to land on; the deck is dark, so the desk separates by
          being the brightest flat thing in the room, not by an outline.
       ⛔ THE FRAME IS NEAR-BLACK AND YOU CAN SEE THE DECK THROUGH IT. Two legs, no pedestal, no
          cross-rail in the void — a desk is a plane held up (the v9c law, still binding).
       ⛔ ONE HUGE FEATURE PER STATION: the CRT. Beige case, black glass, green phosphor, 14x12 — it
          eats the back half of the slab. Everything else on the desk is a 2-3px accent.
       ⛔ THE OUTLINE IS A DARK TINT OF THE OBJECT'S OWN HUE (each ramp carries its own `ink`). */
  const LAM = { ink: '#35322b', ao: '#5a564b', dk: '#7a7568', face: '#a09a8c', top: '#aea89a', mid: '#bab4a5', lit: '#c8c2b3', hi: '#d5cfc0', sheen: '#e0dbcd' };
  const FRM = { ink: '#15130e', ao: '#1e1c16', dk: '#28261f', face: '#333129', top: '#3d3b32', mid: '#48463d', lit: '#555247', hi: '#635f53', sheen: '#6f6b5e' };
  const CRTB = { ink: '#4a4030', ao: '#665a43', dk: '#8c7d60', face: '#b3a483', top: '#c0b18f', mid: '#cbbd9b', lit: '#d8ccab', hi: '#e3d9bb', sheen: '#ede5c9' };
  const GLASS_OFF = '#0a1410', GLASS_RIM = '#16231b';

  /* the slab: 7 rows of top plane falling from the lit far edge to the near edge, a 2-row thickness,
     a hairline apron. `x..x+w-1` is the footprint; the slab overhangs it by one px each side so the
     legs sit visibly INSIDE the plane. */
  const wsSlab = (x, y, w) => {
    chamf(x - 2, y - 4, w + 4, 11, LAM.ink, 1);                      // silhouette, own-hue ink
    px(x - 1, y - 3, w + 2, 1, LAM.sheen);                           // far edge: the ceiling strip's row
    px(x - 1, y - 2, w + 2, 2, LAM.hi);
    px(x - 1, y, w + 2, 2, LAM.lit);
    px(x - 1, y + 2, w + 2, 2, LAM.mid);
    px(x - 1, y + 4, w + 2, 1, LAM.top);                             // near edge of the plane
    keyEdge(x + 1, y - 3, 9, 1, 0.22);                               // warm key, west-biased
    px(x - 1, y - 2, 1, 6, LAM.lit); px(x + w, y - 2, 1, 6, LAM.dk); // side lips: lit west, shade east
    rimEdge(x + w, y - 1, 1, 5, 0.16);
    px(x - 1, y + 5, w + 2, 2, LAM.dk);                              // the top's own thickness
    px(x - 1, y + 5, w + 2, 1, LAM.face);
    px(x - 1, y + 7, w + 2, 1, FRM.face);                            // apron rail
  };
  /* two legs at the ends, near-black, the deck visible between them. Feet on y+h-1. */
  const wsLegs = (x, y, w, h) => {
    for (const s of [0, 1]) {
      const lx = s ? x + w - 4 : x + 1;
      px(lx, y + 8, 3, h - 8, FRM.ink);
      px(lx + (s ? 2 : 0), y + 8, 1, h - 9, s ? FRM.dk : FRM.lit);   // the lit face is west
      px(lx - 1, y + h - 1, 5, 1, FRM.ink);                          // foot
    }
    ctx.globalAlpha = 0.16; px(x + 4, y + 8, w - 8, 2, '#000'); ctx.globalAlpha = 1;   // the slab's own shade on the deck
  };
  /* THE CRT. `mx`/`mt` = case top-left; bw x bh case; the glass is inset 2. Draws its neck + foot
     down onto the slab at `sy` (the slab's y). `tint` = the screen family (green work / magenta art). */
  const wsCrt = (mx, mt, bw, bh, sy, on, ph, tint, body) => {
    const c = body || CRTB;
    px(mx + Math.floor(bw / 2) - 2, mt + bh, 4, sy - 3 - (mt + bh), c.ao);        // neck
    px(mx + Math.floor(bw / 2) - 2, mt + bh, 1, sy - 3 - (mt + bh), c.dk);
    chamf(mx + 2, sy - 3, bw - 4, 2, c.ink, 1); px(mx + 3, sy - 3, bw - 6, 1, c.top);   // foot
    chamf(mx - 1, mt - 1, bw + 2, bh + 2, c.ink, 2);                 // case silhouette
    px(mx, mt, bw, bh, c.face);
    px(mx, mt, bw, 2, c.lit); px(mx + 1, mt, Math.max(3, bw >> 1), 1, c.hi);   // lit crown + west catch
    px(mx, mt + 2, 1, bh - 4, c.top); px(mx + bw - 1, mt + 2, 1, bh - 4, c.dk);
    rimEdge(mx + bw - 1, mt + 3, 1, bh - 6, 0.18);
    px(mx, mt + bh - 2, bw, 2, c.dk);                                // the chin
    px(mx + 2, mt + bh - 1, 3, 1, c.ao);                             // brand slit
    px(mx + bw - 3, mt + bh - 1, 1, 1, on ? ACC.flow : U.shade(ACC.flow, -0.62));   // power lamp
    const gx = mx + 2, gy = mt + 2, gw = bw - 4, gh = bh - 5;
    px(gx - 1, gy - 1, gw + 2, gh + 2, c.ink);                       // glass surround
    if (on) {
      const sc = tint || scr(ph);
      px(gx, gy, gw, gh, U.shade(sc, -0.74));
      px(gx, gy, gw, 1, U.shade(sc, -0.2));                          // title bar
      for (let j = 1; j < gh - 1; j++) codeRow(gx + 1, gy + j, gw - 2, j * 2 + Math.floor(ph), sc, '#eaffe8');
      px(gx + (Math.floor(now / 300) % (gw - 2)), gy + gh - 1, 1, 1, blink(400, ph) ? '#eaffe8' : U.shade(sc, -0.6));
      scanl(gx, gy, gw, gh, 0.18);
      bloom(gx, gy, gw, gh, sc, 0.16);
      spill(mx + 1, sy - 3, bw - 2, sc, 0.16, 4);
    } else {
      px(gx, gy, gw, gh, GLASS_OFF);
      px(gx, gy, Math.min(5, gw), 1, GLASS_RIM); px(gx + 1, gy + 1, 2, 1, '#111c15');
    }
  };
  /* a keyboard: near-black tray, PALE keycaps in two staggered rows — dark body, light caps. */
  const wsKeys = (kx, ky, kw) => {
    chamf(kx - 1, ky - 1, kw + 2, 5, FRM.ink, 1);
    px(kx, ky, kw, 3, FRM.top);
    for (let i = 0; i < kw - 1; i += 2) { px(kx + i, ky, 1, 1, LAM.hi); px(kx + i + 1, ky + 1, 1, 1, LAM.mid); }
    px(kx + 2, ky + 2, kw - 4, 1, LAM.top);                          // space bar
  };
  /* a small mini-PC standing on the slab (west end): the one DARK focal object on the pale plane */
  const wsMini = (px0, py0, on, ph) => {
    chamf(px0 - 1, py0 - 1, 8, 11, FRM.ink, 1);
    px(px0, py0, 6, 9, FRM.face);
    px(px0, py0, 6, 1, FRM.hi); px(px0, py0 + 1, 1, 8, FRM.lit);
    px(px0 + 1, py0 + 2, 4, 1, FRM.ao); px(px0 + 1, py0 + 4, 4, 1, FRM.ao); px(px0 + 1, py0 + 6, 4, 1, FRM.ao);   // vents
    px(px0 + 4, py0 + 8, 1, 1, on ? ACC.work : U.shade(ACC.work, -0.66));
    if (on) { bloom(px0 + 4, py0 + 8, 1, 1, ACC.work, 0.24); px(px0 + 1, py0 + 8, 1, 1, blink(280, ph) ? ACC.flow : U.shade(ACC.flow, -0.6)); }
  };
  const wsMug = (mx, my) => {                                        // a teal mug — the one saturated cold note
    px(mx, my, 3, 3, '#1d3f3a'); px(mx, my, 3, 1, '#4a8a82'); px(mx + 1, my, 1, 1, '#6fb3aa');
    px(mx + 3, my + 1, 1, 1, '#2f6a62');
  };

  F.desk = (x, y, w, h, f) => {
    /* v46 DESK (2x1) — the ordinary office desk, rebuilt on the workstation kit: pale laminate slab on
       a near-black frame, a BIG beige CRT east, a slim mini-PC west, keyboard and mug in front. */
    const on = !!f.work, ph = f.x || 0;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x - 3, y + h - 3, on);
    cable(x - 1, y + 8, x - 3, y + h - 3, 1.6);
    wsLegs(x, y, w, h);
    wsSlab(x, y, w);
    wsMini(x + 1, y - 13, on, ph);
    wsCrt(x + 9, y - 17, 14, 12, y, on, ph, null);
    wsKeys(x + 9, y + 1, 11);
    wsMug(x + 3, y + 1);
  };

  F.desk2 = (x, y, w, h, f) => {
    /* v46 DUAL DESK (2x1) — the same slab and frame, TWO CRTs on it and no PC: they are what you see.
       ⛔ TWO SCREENS MUST NOT BE ONE WIDE SCREEN — a real gap between the cases. */
    const on = !!f.work, ph = f.x || 0;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x + w + 1, y + h - 3, on);
    cable(x + w, y + 8, x + w + 2, y + h - 3, 1.6);
    wsLegs(x, y, w, h);
    wsSlab(x, y, w);
    wsCrt(x - 1, y - 16, 12, 11, y, on, ph, null);
    wsCrt(x + 13, y - 16, 12, 11, y, on, ph + 3, null);
    wsKeys(x + 6, y + 1, 12);
  };

  F.pixelrig = (x, y, w, h, f) => {
    /* v46 PIXEL RIG (2x1) — the art station. Same slab; the kit is a wide beige display pushed back,
       a big TILTED drawing tablet across the front, and a stylus. Its glow is MAGENTA, not green. */
    const on = !!f.work, ph = f.x || 0, P = ACC.lounge;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x + w + 1, y + h - 3, on);
    cable(x + w, y + 8, x + w + 2, y + h - 3, 1.6);
    wsLegs(x, y, w, h);
    wsSlab(x, y, w);
    wsCrt(x + 3, y - 16, 18, 11, y, on, ph, P);
    // the tablet: a wedge stepping in one px per row — a flat rectangle is a mousemat
    for (let i = 0; i < 4; i++) {
      const ty = y + i, ins = 3 - i;
      px(x + 1 + ins, ty, w - 2 - ins * 2, 1, FRM.ink);
      px(x + 2 + ins, ty, w - 4 - ins * 2, 1, i === 0 ? FRM.hi : i < 2 ? FRM.mid : FRM.face);
    }
    px(x + 5, y + 1, w - 10, 2, '#120a14');                          // active surface
    if (on) {
      for (let k = 0; k < 3; k++) { const t = ((now / 900) + k / 3) % 1; px(x + 6 + Math.floor(t * (w - 13)), y + 1 + (k % 2), 1, 1, U.shade(P, 0.30)); }
      bloom(x + 5, y + 1, w - 10, 2, P, 0.14);
    }
    px(x + 3, y + 3, 2, 1, on ? P : U.shade(P, -0.66));               // tablet lamp
    px(x + w - 6, y, 5, 1, FRM.ink); px(x + w - 5, y, 3, 1, LAM.hi);  // stylus in its cradle
  };

  F.console = (x, y, w, h, f) => {
    /* v46 OPS CONSOLE (2x1) — the instrument station: a near-black instrument bank BUILT INTO the
       back of the slab (not a monitor stood on it), one wide green scope in it, a bar-graph beside,
       and physical dials on the working surface. The bank is the dark focal mass on the pale plane. */
    const on = !!f.work, ph = f.x || 0, G = ACC.work;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x - 3, y + h - 3, on);
    cable(x - 1, y + 8, x - 3, y + h - 3, 1.6);
    wsLegs(x, y, w, h);
    wsSlab(x, y, w);
    const bX = x - 1, bW = w + 2, bT = y - 13;
    chamf(bX - 1, bT - 1, bW + 2, 12, FRM.ink, 2);                   // the bank: raked, one casting
    px(bX, bT, bW, 10, FRM.face);
    px(bX, bT, bW, 2, FRM.hi); px(bX + 1, bT, 7, 1, FRM.sheen);      // lit crown
    px(bX, bT + 2, 1, 8, FRM.lit); px(bX + bW - 1, bT + 2, 1, 8, FRM.ao);
    px(bX + 1, bT + 9, bW - 2, 1, FRM.ao);
    // the scope, west: a wide green glass sunk into the bank
    const sx = bX + 2, sy2 = bT + 3, sw = 13, sh2 = 5;
    px(sx - 1, sy2 - 1, sw + 2, sh2 + 2, '#050b07');
    if (on) {
      const sc = scr(ph);
      px(sx, sy2, sw, sh2, U.shade(sc, -0.70));
      for (let i = 0; i < sw; i++) px(sx + i, sy2 + 2 - Math.round(Math.sin(now / 190 + i * 0.7) * 1.4), 1, 1, ACC.data);
      px(sx, sy2, sw, 1, U.shade(sc, -0.30));
      scanl(sx, sy2, sw, sh2, 0.18); bloom(sx, sy2, sw, sh2, sc, 0.16);
      spill(bX + 1, bT + 10, bW - 2, sc, 0.16, 4);
    } else { px(sx, sy2, sw, sh2, GLASS_OFF); px(sx, sy2, 4, 1, GLASS_RIM); }
    // the bar-graph, east
    px(bX + 17, bT + 2, 8, 7, '#050b07');
    for (let i = 0; i < 6; i++) {
      const v = 1 + Math.floor((1 + Math.sin(now / 260 + i * 0.9 + ph)) * (on ? 1.6 : 0.5));
      px(bX + 18 + i, bT + 8 - v, 1, v, on ? U.shade(G, 0.10) : U.shade(G, -0.62));
    }
    if (on) bloom(bX + 18, bT + 3, 6, 5, G, 0.16);
    // physical controls on the working surface
    dial(x + 2, y, LAM.dk, now / 900 + ph); dial(x + 6, y, LAM.dk, -now / 640 + ph);
    for (let i = 0; i < 4; i++) { px(x + 11 + i * 2, y, 1, 2, FRM.face); px(x + 11 + i * 2, y, 1, 1, blink(600, i) ? ACC.flow : '#33241a'); }
    chamf(x + 19, y, 5, 3, FRM.ink, 1); px(x + 20, y + 1, 3, 1, LAM.hi);   // keypad block
  };

  F.consoleL = (x, y, w, h, f) => {
    /* v46 CONSOLE L (3x1) — the console's big brother: a three-bay instrument bank on one slab, the
       bays carrying UNLIKE kit (scope · bar-graph · switch matrix) split by full-height dividers. */
    const on = !!f.work, ph = f.x || 0, G = ACC.work;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x - 3, y + h - 3, on);
    cable(x - 1, y + 8, x - 3, y + h - 3, 1.6);
    wsLegs(x, y, w, h);
    px(x + 16, y + 8, 3, h - 8, FRM.ink); px(x + 16, y + 8, 1, h - 9, FRM.lit);   // centre leg on a 3-wide span
    wsSlab(x, y, w);
    const bX = x - 1, bW = w + 2, bT = y - 13;
    chamf(bX - 1, bT - 1, bW + 2, 12, FRM.ink, 2);
    px(bX, bT, bW, 10, FRM.face);
    px(bX, bT, bW, 2, FRM.hi); px(bX + 1, bT, 9, 1, FRM.sheen);
    px(bX, bT + 2, 1, 8, FRM.lit); px(bX + bW - 1, bT + 2, 1, 8, FRM.ao);
    px(bX + 1, bT + 9, bW - 2, 1, FRM.ao);
    const bayW = Math.floor((bW - 2) / 3);
    for (let k = 1; k < 3; k++) { px(bX + 1 + k * bayW, bT + 2, 1, 8, FRM.ao); px(bX + k * bayW, bT + 2, 1, 8, FRM.mid); }
    // bay 1: scope
    const sx = bX + 2, sy2 = bT + 3, sw = bayW - 3, sh2 = 5;
    px(sx - 1, sy2 - 1, sw + 2, sh2 + 2, '#050b07');
    if (on) {
      const sc = scr(ph);
      px(sx, sy2, sw, sh2, U.shade(sc, -0.70));
      for (let i = 0; i < sw; i++) px(sx + i, sy2 + 2 - Math.round(Math.sin(now / 190 + i * 0.7) * 1.4), 1, 1, ACC.data);
      scanl(sx, sy2, sw, sh2, 0.18); bloom(sx, sy2, sw, sh2, sc, 0.16);
    } else { px(sx, sy2, sw, sh2, GLASS_OFF); px(sx, sy2, 3, 1, GLASS_RIM); }
    // bay 2: bar-graph
    const gx = bX + 2 + bayW;
    px(gx - 1, bT + 2, bayW - 1, 7, '#050b07');
    for (let i = 0; i < bayW - 3; i++) {
      const v = 1 + Math.floor((1 + Math.sin(now / 260 + i * 0.8 + ph)) * (on ? 1.6 : 0.5));
      px(gx + i, bT + 8 - v, 1, v, on ? U.shade(G, 0.10) : U.shade(G, -0.62));
    }
    if (on) bloom(gx, bT + 3, bayW - 3, 5, G, 0.16);
    // bay 3: switch matrix
    const mx = bX + 2 + bayW * 2;
    for (let ry = 0; ry < 3; ry++) for (let rx = 0; rx < 5; rx++)
      px(mx + rx * 2, bT + 3 + ry * 2, 1, 1, blink(600 + rx * 130, rx + ry) ? (rx === 4 ? ACC.flow : G) : '#16241c');
    if (on) { bloom(mx, bT + 3, bayW - 3, 5, G, 0.12); spill(bX + 1, bT + 10, bW - 2, scr(ph), 0.16, 4); }
    dial(x + 2, y, LAM.dk, now / 900 + ph); dial(x + 6, y, LAM.dk, -now / 640 + ph);
    for (let i = 0; i < 5; i++) { px(x + 12 + i * 2, y, 1, 2, FRM.face); px(x + 12 + i * 2, y, 1, 1, blink(600, i) ? ACC.flow : '#33241a'); }
    chamf(x + 26, y, 7, 3, FRM.ink, 1); px(x + 27, y + 1, 5, 1, LAM.hi);
    wsMug(x + w - 4, y + 2);
  };

  F.bench = (x, y, w, h, f) => {
    /* v46 BENCH (4x1) — one long pale slab, TWO unlike stations with real empty top between them.
       ⛔ 48px IS A HORIZON UNLESS YOU BREAK ITS RHYTHM — the gap does the work. Four legs. */
    const on = !!f.work, ph = f.x || 0, G = ACC.work;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x + w + 1, y + h - 3, on);
    cable(x + w, y + 8, x + w + 2, y + h - 3, 1.6);
    wsLegs(x, y, w, h);
    for (const lx of [x + 15, x + 30]) { px(lx, y + 8, 3, h - 8, FRM.ink); px(lx, y + 8, 1, h - 9, FRM.lit); }
    wsSlab(x, y, w);
    // station A, west: CRT + keyboard
    wsCrt(x + 1, y - 16, 13, 11, y, on, ph, null);
    wsKeys(x + 2, y + 1, 11);
    // the gap: a mug and a coiled lead, nothing else
    wsMug(x + 20, y);
    px(x + 24, y + 2, 5, 1, FRM.face); px(x + 25, y + 1, 3, 1, FRM.mid);
    // station B, east: a black terminal tower with a bar-graph — no keyboard
    const tX = x + 33, tW = 13, tT = y - 12;
    chamf(tX - 1, tT - 1, tW + 2, 13, FRM.ink, 1);
    px(tX, tT, tW, 11, FRM.face);
    px(tX, tT, tW, 2, FRM.hi); px(tX + 1, tT, 5, 1, FRM.sheen);
    px(tX, tT + 2, 1, 9, FRM.lit); px(tX + tW - 1, tT + 2, 1, 9, FRM.ao);
    px(tX + 2, tT + 3, tW - 4, 5, '#050b07');
    for (let i = 0; i < tW - 5; i++) {
      const v = 1 + Math.floor((1 + Math.sin(now / 240 + i * 0.9 + ph)) * (on ? 1.4 : 0.4));
      px(tX + 3 + i, tT + 7 - v, 1, v, on ? U.shade(G, 0.10) : U.shade(G, -0.62));
    }
    if (on) { bloom(tX + 2, tT + 3, tW - 4, 5, G, 0.18); spill(tX + 1, y - 1, tW - 2, G, 0.14, 4); }
    px(tX + 2, tT + 9, 3, 1, blink(700) ? ACC.flow : U.shade(ACC.flow, -0.66));
  };

  F.workbench = (x, y, w, h, f) => {
    /* v46 WORKBENCH (2x1) — TERMINAL: shell.exec + verify.run. No chair, no CRT: you stand at it.
       ⛔ THE PEGBOARD IS THE HERO, and it is PALE — a cream perforated board with DARK tools hung on
          it, read by outline. The v45 board was a dark panel with grey tools on it: invisible.
       ⛔ The top is the same pale slab with a dark rubber work mat on it, a brass-screw vice, an iron
          in its stand and a meter — the fired/bad pulse is the only telemetry it shows. */
    const on = !!f.work, fired = f && f.fired, bad = f && f.bad, G = ACC.work, R2 = ACC.alert, br = MAT.brass;
    shadow2(x + 1, y + h - 1, w - 2);
    deckSocket(x + w + 1, y + h - 3, on);
    wsLegs(x, y, w, h);
    px(x + 4, y + 9, w - 8, 2, FRM.ink); px(x + 5, y + 9, w - 10, 1, FRM.mid);          // stock shelf
    for (const bx of [x + 6, x + 13]) { px(bx, y + 7, 4, 2, FRM.ink); px(bx + 1, y + 7, 2, 1, LAM.dk); }
    wsSlab(x, y, w);
    // pegboard: pale, perforated, on two black standards
    const pT = y - 17, pH = 12;
    px(x + 1, pT + 2, 1, 14, FRM.ink); px(x + w - 2, pT + 2, 1, 14, FRM.ink);
    chamf(x - 1, pT - 1, w + 2, pH + 2, LAM.ink, 1);
    px(x, pT, w, pH, LAM.top);
    px(x, pT, w, 1, LAM.sheen); px(x, pT + 1, 1, pH - 1, LAM.lit); px(x + w - 1, pT + 1, 1, pH - 1, LAM.dk);
    for (let ry = 0; ry < 5; ry++) for (let rx = 0; rx < 11; rx++) px(x + 2 + rx * 2, pT + 2 + ry * 2, 1, 1, LAM.ao);
    // tools, dark, read by outline
    px(x + 3, pT + 2, 1, 7, FRM.face); px(x + 2, pT + 2, 3, 1, FRM.hi);                   // driver
    px(x + 7, pT + 2, 1, 8, FRM.face); px(x + 5, pT + 2, 5, 2, FRM.ink); px(x + 6, pT + 2, 3, 1, FRM.mid);   // hammer
    px(x + 12, pT + 2, 1, 7, FRM.face); px(x + 11, pT + 2, 1, 3, FRM.ink); px(x + 13, pT + 2, 1, 3, FRM.ink);   // wrench
    px(x + 16, pT + 3, 5, 1, FRM.face); px(x + 16, pT + 2, 1, 5, FRM.ink);                // square
    px(x + 17, pT + 7, 4, 4, FRM.ink); px(x + 18, pT + 8, 2, 2, br.mid);                  // clamp, brass jaw
    px(x + 2, pT + 10, 9, 2, FRM.ink); px(x + 3, pT + 10, 7, 1, FRM.mid);                 // parts tray on the rail
    // on the top: rubber mat, vice, iron, meter
    px(x + 1, y - 1, w - 2, 5, FRM.face); px(x + 1, y - 1, w - 2, 1, FRM.mid);            // the mat
    px(x + 2, y - 4, 6, 5, FRM.ink); px(x + 3, y - 3, 4, 3, LAM.dk); px(x + 3, y - 3, 4, 1, LAM.lit);   // vice
    px(x + 4, y - 4, 1, 1, br.hi); px(x + 5, y - 4, 1, 1, br.dk);
    px(x + 11, y - 2, 6, 3, FRM.ink); px(x + 12, y - 1, 4, 1, FRM.mid);                    // iron stand
    px(x + 14, y - 5, 1, 4, LAM.dk); px(x + 14, y - 6, 1, 1, fired && !bad ? '#ffd0a0' : FRM.hi);
    px(x + 18, y - 3, 5, 4, FRM.ink); px(x + 19, y - 2, 3, 2, LAM.face);                   // meter
    px(x + 19, y - 2, 1, 1, on ? G : U.shade(G, -0.66));
    if (fired) {
      const c = bad ? R2 : G;
      px(x + 1, y + 4, w - 2, 1, c);
      bloom(x + 1, y + 2, w - 2, 3, c, 0.30);
      spill(x + 1, y + 5, w - 2, c, 0.22, 4);
    } else if (on) { px(x + 1, y + 4, 6, 1, U.shade(G, -0.30)); bloom(x + 1, y + 4, 6, 1, G, 0.12); }
  };
