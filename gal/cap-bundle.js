  /* ============ v46 CAPABILITY KIT (2026-09-02) ============
     The capability objects rebuilt on the same finding as the workstations: the casings were all
     MAT.steel's dark band, so eight capabilities read as eight dark grey boxes. STL is the same steel
     hue authored HIGH — a big pale mass edge to edge, the way the approved VAULT reads — over the
     near-black FRM frame, with ONE saturated element per capability doing the work (cyan = web,
     manila/brass = files, purple = memory, magenta = studio). Kept as shipped, because Andrew signed
     them off against a reference: vault, safe, connector portal, comms dish, comms uplink. */
  const STL = { ink: '#2a3035', ao: '#3c444b', dk: '#586169', face: '#7f8890', top: '#8e979e', mid: '#9ca5ac', lit: '#adb5bb', hi: '#bcc3c8', sheen: '#cbd1d5' };
  const MANILA = { dk: '#8a6a34', face: '#c9a458', lit: '#e2c27a', hi: '#f0d898' };
  const PURPLE = ACC.mem, CYAN = ACC.data, MAG = ACC.lounge;
  /* a pale steel carcass: chamfered silhouette, lit crown (2 rows), lit west flank, shade east flank,
     a dark floor-line row. `t`..`t+hh` on x..x+ww. */
  const capBody = (bx, t, ww, hh, m) => {
    m = m || STL;
    chamf(bx - 1, t - 1, ww + 2, hh + 2, m.ink, 2);
    px(bx, t, ww, hh, m.face);
    px(bx, t, ww, 2, m.lit); px(bx + 1, t, Math.max(3, ww >> 1), 1, m.sheen);
    keyEdge(bx + 1, t, Math.max(3, ww >> 2), 1, 0.22);
    px(bx, t + 2, 1, hh - 3, m.top); px(bx + ww - 1, t + 2, 1, hh - 3, m.dk);
    rimEdge(bx + ww - 1, t + 3, 1, hh - 6, 0.16);
    px(bx, t + hh - 1, ww, 1, m.ao);
  };
  /* a near-black plinth the carcass stands on, one px wider each side, feet on `floor` */
  const capPlinth = (bx, floor, ww) => {
    px(bx - 1, floor - 2, ww + 2, 3, FRM.ink);
    px(bx, floor - 2, ww, 1, FRM.lit);
    px(bx + 1, floor - 1, 2, 1, FRM.dk); px(bx + ww - 3, floor - 1, 2, 1, FRM.dk);
  };

  F.comms_beacon = (x, y, w, h, f) => {
    /* v46 BEACON (1x2) — a lighthouse in a tile: a pale steel column carrying ONE big fresnel lens
       head, cyan. The head is two-thirds of the width and a third of the height — the lens IS the prop. */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x - 1, base - 4, w + 2, 4);
    deckSocket(x + w + 1, base - 3, on);
    capPlinth(x + 1, base - 4, w - 2);
    // the column: pale, narrower than the head
    capBody(x + 3, y + 4, w - 6, base - 8 - y, STL);
    for (let i = 0; i < 3; i++) px(x + 4, y + 8 + i * 4, w - 8, 1, STL.dk);      // collar rings
    px(x + 4, base - 7, w - 8, 2, FRM.face); px(x + 4, base - 7, w - 8, 1, FRM.hi);   // service hatch
    px(x + 5, base - 6, 1, 1, on ? ACC.work : U.shade(ACC.work, -0.62));
    // THE LENS HEAD: a glass drum in a black cage, cyan bands, a hot core when working
    const hx = x + 1, hy = y - 8, hw = w - 2, hh = 12;
    chamf(hx - 1, hy - 1, hw + 2, hh + 2, FRM.ink, 2);
    px(hx, hy, hw, 2, STL.lit); px(hx + 1, hy, 4, 1, STL.sheen);                    // cap
    px(hx, hy + hh - 2, hw, 2, FRM.face); px(hx, hy + hh - 2, hw, 1, FRM.hi);       // base ring
    const gy = hy + 2, gh = hh - 4;
    px(hx, gy, hw, gh, on ? '#0b2a34' : '#0a1a20');                                  // glass
    for (let j = 0; j < gh; j += 2) px(hx, gy + j, hw, 1, on ? U.shade(CYAN, -0.45) : U.shade(CYAN, -0.75));   // fresnel ridges
    px(hx, gy, 1, gh, U.shade(CYAN, on ? -0.2 : -0.6)); px(hx + hw - 1, gy, 1, gh, '#071a20');   // rim light west
    // the lamp core: rotates around the drum on a 1.6s cycle when live, a dead ember idle
    if (on) {
      const t = (now / 1600 + ph * 0.13) % 1, cxp = hx + 1 + Math.round(t * (hw - 4));
      px(cxp, gy + 1, 2, gh - 2, '#dffbff'); px(cxp - 1, gy + 2, 4, gh - 4, U.shade(CYAN, 0.25));
      px(cxp, gy + 2, 2, gh - 4, '#ffffff');
      bloom(hx, gy, hw, gh, CYAN, 0.30);
      spill(hx, hy + hh, hw, CYAN, 0.16, 5);
      glow(x - 2, hy - 3, w + 4, 2, CYAN, 0.10 + 0.08 * Math.sin(now / 300));           // the beam's sweep on the ceiling
    } else {
      px(hx + Math.floor(hw / 2) - 1, gy + 2, 2, gh - 4, blink(1400, ph) ? U.shade(CYAN, -0.30) : '#12343c');
    }
    px(hx + Math.floor(hw / 2) - 1, hy - 3, 2, 2, FRM.face); px(hx + Math.floor(hw / 2) - 1, hy - 3, 1, 1, FRM.hi);   // finial
  };

  F.war_intelcab = (x, y, w, h, f) => {
    /* v46 INTEL CAB (1x2) — a pale steel filing cabinet: four drawers, the TOP ONE PULLED OPEN with
       manila folders standing in it. Manila is the strongest "these are files" signal at this size. */
    const on = !!(f && f.work), base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x - 1, base - 4, w + 2, 4);
    deckSocket(x + w + 1, base - 3, on);
    capPlinth(x, base - 4, w);
    const T = y - 8, H = base - 6 - T;
    capBody(x, T, w, H, STL);
    // three closed drawers below: each a pale front with a dark recessed pull and a label slot
    for (let i = 0; i < 3; i++) {
      const dy = T + 11 + i * 6;
      px(x + 1, dy, w - 2, 1, STL.ao);                                   // the gap above the drawer
      px(x + 1, dy + 1, w - 2, 5, STL.top);
      px(x + 1, dy + 1, w - 2, 1, STL.hi);
      px(x + 3, dy + 3, w - 6, 2, FRM.face); px(x + 3, dy + 3, w - 6, 1, FRM.hi);   // the pull
      px(x + 2, dy + 2, 2, 1, MANILA.face);                                // label
    }
    // THE OPEN DRAWER: its top plane seen from above (pale), the drawer front proud, folders inside
    const oy = T + 3;
    px(x - 1, oy + 4, w + 2, 5, STL.ink);                                  // drawer front, pulled toward us
    px(x, oy + 5, w, 3, STL.mid); px(x, oy + 5, w, 1, STL.sheen);
    px(x + 3, oy + 6, w - 6, 1, FRM.face);                                 // its pull
    px(x, oy, w, 4, STL.ao);                                               // the drawer's interior seen from above
    for (let i = 0; i < 4; i++) {                                          // manila folders, tabs staggered
      const fx = x + 1 + i * 2 + (i & 1);
      px(fx, oy + (i & 1), 2, 4 - (i & 1), i % 2 ? MANILA.face : MANILA.lit);
      px(fx, oy + (i & 1), 1, 1, MANILA.hi);
    }
    px(x + w - 3, oy + 1, 2, 3, MANILA.dk); px(x + w - 3, oy + 1, 2, 1, MANILA.face);
    // status lamp on the crown
    px(x + w - 3, T + 1, 1, 1, on ? ACC.work : U.shade(ACC.work, -0.62));
    if (on) bloom(x + w - 3, T + 1, 1, 1, ACC.work, 0.22);
  };

  F.rack = (x, y, w, h, f) => {
    /* v46 RACK (2x1) — a pale steel server cabinet: lit crown, pale rails, and inside the dark bay
       FIVE countable blades, each a pale slab with its own green LED. The rails are what say
       "rack"; the blades are what say "server". */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x, base - 4, w, 4);
    deckSocket(x + w + 1, base - 3, on);
    cable(x + w - 2, y - 6, x + w + 2, base - 3, 2.2);
    capPlinth(x, base - 3, w);
    const T = y - 14, H = base - 4 - T;
    capBody(x, T, w, H, STL);
    // the bay: a dark well inside the rails
    px(x + 2, T + 3, w - 4, H - 5, FRM.ao);
    px(x + 2, T + 3, w - 4, 1, FRM.ink);
    for (let i = 0; i < 5; i++) {                                          // five blades
      const by = T + 4 + i * 4;
      px(x + 3, by, w - 6, 3, i < 2 ? STL.mid : i < 4 ? STL.top : STL.face);
      px(x + 3, by, w - 6, 1, i < 2 ? STL.hi : STL.lit);
      px(x + 3, by + 2, w - 6, 1, STL.dk);
      px(x + 4, by + 1, 5, 1, FRM.ao);                                     // drive slot
      px(x + w - 5, by + 1, 1, 1, (on && blink(300 + i * 90, ph + i)) || (!on && i === 0 && blink(1600, ph)) ? ACC.work : U.shade(ACC.work, -0.62));
      px(x + w - 7, by + 1, 1, 1, on && blink(700, i) ? ACC.flow : U.shade(ACC.flow, -0.62));
    }
    if (on) bloom(x + w - 6, T + 4, 3, 19, ACC.work, 0.14);
    for (let i = 0; i < 6; i++) { px(x + 1, T + 4 + i * 3, 1, 1, STL.ao); px(x + w - 2, T + 4 + i * 3, 1, 1, STL.ao); }   // rail holes
  };

  F.shelf = (x, y, w, h, f) => {
    /* v46 SHELF (4x1) — an open pale steel shelving unit on black uprights: two boards, and on them
       manila archive boxes and binders, with one genuinely empty bay. Files, not decor. */
    const on = !!(f && f.work), base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    const T = y - 14;
    for (const ux of [x, x + 23, x + w - 3]) {                             // three black uprights
      px(ux, T, 3, base - T, FRM.ink);
      px(ux, T, 1, base - T - 1, FRM.lit);
      px(ux - 1, base - 1, 5, 1, FRM.ink);
    }
    for (const sy of [T + 1, T + 11, base - 3]) {                          // three boards, pale, seen from above
      px(x, sy, w, 3, STL.ink);
      px(x, sy, w, 2, STL.lit); px(x + 1, sy, 10, 1, STL.sheen); keyEdge(x + 1, sy, 6, 1, 0.2);
      px(x, sy + 2, w, 1, STL.dk);
      ctx.globalAlpha = 0.22; px(x + 3, sy + 3, w - 6, 2, '#000'); ctx.globalAlpha = 1;   // the board's shade on what is below
    }
    // top board: five archive boxes west, one binder row east, an EMPTY span in the middle
    for (let i = 0; i < 4; i++) {
      const bx = x + 4 + i * 5;
      px(bx, T - 5, 4, 6, MANILA.dk); px(bx, T - 5, 4, 1, MANILA.hi); px(bx, T - 4, 3, 4, MANILA.face);
      px(bx + 1, T - 2, 2, 1, FRM.face);                                   // the hand hole
    }
    for (let i = 0; i < 5; i++) {
      const bx = x + 30 + i * 3, c = i % 2 ? '#6a4a8a' : '#8e4356';
      px(bx, T - 6, 2, 7, U.shade(c, -0.3)); px(bx, T - 6, 2, 1, U.shade(c, 0.25)); px(bx, T - 3, 2, 1, MANILA.lit);
    }
    // middle board: two crates + folders leaning, empty east
    for (const bx of [x + 4, x + 11]) { px(bx, T + 6, 6, 5, STL.dk); px(bx, T + 6, 6, 1, STL.lit); px(bx + 1, T + 8, 4, 1, FRM.face); }
    for (let i = 0; i < 4; i++) { const fx = x + 25 + i * 2; px(fx, T + 5 + (i & 1), 1, 6 - (i & 1), i % 2 ? MANILA.face : MANILA.lit); }
    px(x + w - 8, T + 8, 4, 3, STL.top); px(x + w - 8, T + 8, 4, 1, STL.hi);     // one small box east
    // a single lamp on the west upright, honest
    px(x + 1, T + 6, 1, 1, on ? ACC.work : U.shade(ACC.work, -0.62));
  };

  F.core = (x, y, w, h, f) => {
    /* v46 CORE (1x2) — the memory core: a black frame holding ONE big purple plasma tube between a
       pale steel cap and base. The tube is the whole prop; the plasma climbs it when working. */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x - 1, base - 4, w + 2, 4);
    deckSocket(x + w + 1, base - 3, on);
    cable(x + w - 2, base - 8, x + w + 2, base - 3, 1.6);
    // base block, pale
    capBody(x, base - 9, w, 6, STL);
    for (let i = 0; i < 3; i++) px(x + 2 + i * 3, base - 6, 2, 1, STL.ao);        // vents
    // cap, pale, with the finial
    capBody(x, y - 9, w, 5, STL);
    px(x + 4, y - 12, w - 8, 3, FRM.face); px(x + 4, y - 12, w - 8, 1, FRM.hi);
    // the black cage: two uprights
    px(x, y - 4, 2, base - 9 - (y - 4), FRM.ink); px(x, y - 4, 1, base - 9 - (y - 4), FRM.lit);
    px(x + w - 2, y - 4, 2, base - 9 - (y - 4), FRM.ink);
    // THE TUBE
    const tx = x + 2, ty = y - 4, tw = w - 4, th = base - 9 - ty;
    px(tx, ty, tw, th, on ? '#2a0f44' : '#1a0c2a');
    px(tx, ty, 1, th, U.shade(PURPLE, on ? -0.15 : -0.5));                        // glass rim, west
    px(tx + tw - 1, ty, 1, th, '#12061c');
    if (on) {
      for (let j = 0; j < th; j++) {                                           // plasma: a column of pulses climbing
        const t = ((now / 700) + j / th + ph * 0.1) % 1;
        const k = 0.5 + 0.5 * Math.sin(t * 6.283 * 2 + j * 0.4);
        px(tx + 1, ty + j, tw - 2, 1, U.shade(PURPLE, -0.55 + k * 0.5));
        if (k > 0.85) px(tx + 2, ty + j, tw - 4, 1, '#f0d8ff');
      }
      bloom(tx, ty, tw, th, PURPLE, 0.30);
      spill(tx, ty + th, tw, PURPLE, 0.18, 4);
    } else {
      px(tx + 1, ty + 2, tw - 2, th - 4, U.shade(PURPLE, -0.68));
      px(tx + 2, ty + Math.floor(th / 2), tw - 4, 1, blink(1600, ph) ? U.shade(PURPLE, -0.25) : U.shade(PURPLE, -0.6));
    }
    for (let i = 1; i < 4; i++) px(tx, ty + i * Math.floor(th / 4), tw, 1, FRM.ink);   // clamp rings
  };

  F.gigs_servercart = (x, y, w, h, f) => {
    /* v46 SERVER CART (1x1) — at 12px everything is silhouette: castors, a push handle, three blades,
       one purple LED. Pale body on a black chassis. */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    px(x + 1, base - 2, 2, 2, FRM.ink); px(x + w - 3, base - 2, 2, 2, FRM.ink);      // castors
    px(x + 1, base - 2, 1, 1, FRM.hi); px(x + w - 3, base - 2, 1, 1, FRM.hi);
    px(x, base - 4, w, 2, FRM.face); px(x, base - 4, w, 1, FRM.hi);                 // chassis
    capBody(x + 1, y - 6, w - 2, base - 4 - (y - 6), STL);
    for (let i = 0; i < 3; i++) {                                                  // three blades
      const by = y - 4 + i * 4;
      px(x + 2, by, w - 4, 3, i ? STL.top : STL.mid); px(x + 2, by, w - 4, 1, STL.hi); px(x + 2, by + 2, w - 4, 1, STL.dk);
      px(x + w - 4, by + 1, 1, 1, on && blink(400 + i * 130, ph + i) ? PURPLE : U.shade(PURPLE, -0.6));
    }
    if (on) bloom(x + w - 5, y - 4, 3, 11, PURPLE, 0.14);
    px(x + w - 2, y - 10, 2, 5, FRM.ink); px(x + 3, y - 10, w - 4, 2, FRM.ink);     // push handle, up and over
    px(x + 4, y - 10, w - 6, 1, FRM.hi);
  };

  F.bridge_relaystack = (x, y, w, h, f) => {
    /* v46 RELAY STACK (1x2) — a pale cabinet with its drawers OPEN: four trays pulled out, each full
       of relay combs, purple lamps on the trays. Same carcass family as the intel cab, inverted contents. */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x - 1, base - 4, w + 2, 4);
    deckSocket(x + w + 1, base - 3, on);
    capPlinth(x, base - 4, w);
    const T = y - 8, H = base - 6 - T;
    capBody(x, T, w, H, STL);
    for (let i = 0; i < 4; i++) {
      const dy = T + 3 + i * 6;
      px(x + 1, dy, w - 2, 2, FRM.ao);                                             // the open slot
      px(x - 1, dy + 2, w + 2, 3, STL.ink);                                        // tray front, proud
      px(x, dy + 3, w, 1, STL.mid); px(x, dy + 4, w, 1, STL.dk);
      for (let k = 0; k < 4; k++) {                                                // relay combs in the slot
        px(x + 2 + k * 2, dy, 1, 2, k % 2 ? '#c9a458' : STL.hi);
      }
      px(x + w - 3, dy + 3, 2, 1, on && blink(500 + i * 120, ph + i) ? PURPLE : U.shade(PURPLE, -0.6));
    }
    if (on) { bloom(x + w - 4, T + 3, 4, 22, PURPLE, 0.14); }
    px(x + 2, T + 1, 1, 1, on ? ACC.work : U.shade(ACC.work, -0.62));
  };

  F.studio = (x, y, w, h, f) => {
    /* v46 STUDIO (2x2) — the media bench: a pale light table whose whole top is a MAGENTA glass
       plane, a camera on a black tripod beside it, and a drying line of prints above. The glass is
       the one big feature; it burns when an image is really rendering. */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x - 1, base - 4, w + 2, 4);
    deckSocket(x + w + 1, base - 3, on);
    cable(x + w - 3, base - 8, x + w + 2, base - 3, 1.8);
    // the light table: pale slab on black legs, front half of the footprint
    const tT = y + 4;
    for (const lx of [x + 1, x + w - 8]) { px(lx, tT + 9, 3, base - 1 - (tT + 9), FRM.ink); px(lx, tT + 9, 1, base - 2 - (tT + 9), FRM.lit); }
    chamf(x - 1, tT - 1, w - 3, 11, LAM.ink, 1);
    px(x, tT, w - 5, 9, LAM.top); px(x, tT, w - 5, 1, LAM.sheen); px(x, tT + 7, w - 5, 2, LAM.dk);
    const gx = x + 1, gy = tT + 1, gw = w - 7, gh = 6;
    px(gx - 1, gy - 1, gw + 2, gh + 2, FRM.ink);
    if (on) {
      px(gx, gy, gw, gh, U.shade(MAG, -0.55));
      for (let j = 0; j < gh; j++) px(gx, gy + j, gw, 1, U.shade(MAG, -0.6 + 0.12 * Math.sin(now / 400 + j * 0.9 + ph)));
      const sx = gx + Math.floor((now / 90) % gw);                                   // a scanning line
      px(sx, gy, 1, gh, '#ffe0f4');
      bloom(gx, gy, gw, gh, MAG, 0.30); spill(gx, gy + gh + 2, gw, MAG, 0.18, 5);
    } else { px(gx, gy, gw, gh, '#1a0c18'); px(gx, gy, 5, 1, '#2c1628'); }
    // the camera on a tripod, east
    const cx0 = x + w - 4;
    px(cx0 - 3, base - 2, 7, 1, FRM.ink); px(cx0 - 2, y + 10, 1, base - 12 - y, FRM.ink); px(cx0 + 1, y + 10, 1, base - 12 - y, FRM.ink);
    px(cx0 - 1, y + 4, 2, 7, FRM.face); px(cx0 - 1, y + 4, 1, 7, FRM.lit);         // column
    chamf(cx0 - 4, y - 1, 8, 6, FRM.ink, 1); px(cx0 - 3, y, 6, 4, FRM.face); px(cx0 - 3, y, 6, 1, FRM.hi);   // body
    px(cx0 - 3, y + 1, 3, 3, FRM.ink); px(cx0 - 2, y + 2, 1, 1, on ? '#dffbff' : STL.dk);    // lens, glass
    px(cx0 + 1, y + 1, 1, 1, on && blink(300, ph) ? ACC.alert : '#3a1410');           // REC lamp
    // the drying line: a wire with three prints pegged on it, above the table
    const ly = y - 8;
    px(x - 1, ly, w + 2, 1, STL.dk); px(x - 2, ly - 2, 1, 4, FRM.ink); px(x + w + 1, ly - 2, 1, 4, FRM.ink);
    for (let i = 0; i < 3; i++) {
      const pxx = x + 2 + i * 8;
      px(pxx + 2, ly - 1, 1, 2, FRM.hi);                                             // peg
      px(pxx, ly + 1, 5, 6, '#e8e2d6'); px(pxx, ly + 1, 5, 1, '#f6f2ea');
      px(pxx + 1, ly + 2, 3, 4, i === 1 ? U.shade(MAG, -0.2) : i ? '#4a6a8a' : '#5a8a5a');   // the picture
      px(pxx + 1, ly + 2, 1, 1, '#ffffff');
    }
  };
