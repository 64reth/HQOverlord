  F.studio = (x, y, w, h, f) => {
    /* v46 STUDIO (2x2) — the media bench: a pale light table filling the footprint, its whole top a
       MAGENTA glass plane, a small camera on a black tripod behind its east end, a drying line of
       prints strung above. The glass is the one big feature; it burns when an image really renders. */
    const on = !!(f && f.work), ph = (f && f.x) || 0, base = y + h;
    shadow2(x + 1, base - 1, w - 2);
    deckPlate(x - 1, base - 4, w + 2, 4);
    deckSocket(x + w + 1, base - 3, on);
    cable(x + w - 2, base - 7, x + w + 2, base - 3, 1.8);
    // the drying line, strung between two black posts, three prints pegged on it
    const ly = y - 9;
    px(x - 1, ly - 3, 2, 8, FRM.ink); px(x + w - 1, ly - 3, 2, 8, FRM.ink);
    px(x, ly - 3, 1, 1, FRM.hi); px(x + w - 1, ly - 3, 1, 1, FRM.hi);
    px(x + 1, ly, w - 2, 1, STL.dk);
    for (let i = 0; i < 3; i++) {
      const pxx = x + 3 + i * 7;
      px(pxx + 2, ly - 1, 1, 2, FRM.hi);                                              // peg
      px(pxx, ly + 1, 5, 6, '#e8e2d6'); px(pxx, ly + 1, 5, 1, '#f6f2ea');
      px(pxx + 1, ly + 2, 3, 4, i === 1 ? U.shade(MAG, -0.2) : i ? '#4a6a8a' : '#5a8a5a');   // the picture
      px(pxx + 1, ly + 2, 1, 1, '#ffffff');
    }
    // the camera on its tripod, behind the table's east end
    const cx0 = x + w - 4;
    px(cx0 - 3, y + 8, 7, 1, FRM.ink); px(cx0 - 2, y + 4, 1, 4, FRM.ink); px(cx0 + 1, y + 4, 1, 4, FRM.ink);
    px(cx0 - 1, y, 2, 5, FRM.face); px(cx0 - 1, y, 1, 5, FRM.lit);                     // column
    chamf(cx0 - 4, y - 5, 8, 6, FRM.ink, 1); px(cx0 - 3, y - 4, 6, 4, FRM.face); px(cx0 - 3, y - 4, 6, 1, FRM.hi);
    px(cx0 - 3, y - 3, 3, 3, FRM.ink); px(cx0 - 2, y - 2, 1, 1, on ? '#dffbff' : STL.dk);   // lens
    px(cx0 + 1, y - 3, 1, 1, on && blink(300, ph) ? ACC.alert : '#3a1410');            // REC lamp
    // THE LIGHT TABLE: pale slab on black legs, the glass plane taking almost all of the top
    const tT = y + 6;
    for (const lx of [x + 1, x + w - 4]) { px(lx, tT + 9, 3, base - 1 - (tT + 9), FRM.ink); px(lx, tT + 9, 1, base - 2 - (tT + 9), FRM.lit); }
    ctx.globalAlpha = 0.16; px(x + 4, tT + 9, w - 8, 2, '#000'); ctx.globalAlpha = 1;
    chamf(x - 2, tT - 1, w + 4, 11, LAM.ink, 1);
    px(x - 1, tT, w + 2, 9, LAM.top); px(x - 1, tT, w + 2, 1, LAM.sheen); px(x - 1, tT + 7, w + 2, 2, LAM.dk);
    px(x - 1, tT + 7, w + 2, 1, LAM.face);
    const gx = x + 1, gy = tT + 1, gw = w - 2, gh = 5;
    px(gx - 1, gy - 1, gw + 2, gh + 2, FRM.ink);
    if (on) {
      for (let j = 0; j < gh; j++) px(gx, gy + j, gw, 1, U.shade(MAG, -0.58 + 0.14 * Math.sin(now / 400 + j * 0.9 + ph)));
      const sx = gx + Math.floor((now / 90) % gw);                                      // a scanning line
      px(sx, gy, 1, gh, '#ffe0f4');
      bloom(gx, gy, gw, gh, MAG, 0.30); spill(gx, gy + gh + 2, gw, MAG, 0.18, 5);
    } else { px(gx, gy, gw, gh, '#1a0c18'); px(gx, gy, 5, 1, '#2c1628'); }
    px(x + w - 6, tT + 7, 4, 1, on ? MAG : U.shade(MAG, -0.6));                          // the table's own lamp
  };
