#!/usr/bin/env python3
# The five "blank" skins are one figure in five colourways. Rebuilding each through
# Pixellab would cost 13 generations apiece for art we can derive exactly: the OLD
# base/variant frame pairs already encode the recolour as a per-colour mapping.
#
# So: learn colour -> colour from every OLD frame the two sets share, PROVE the map
# reproduces the old variant pixel-for-pixel, then apply it to the NEW 8-direction base.
# A learned map that cannot reproduce its own source is rejected rather than shipped —
# a silent partial mapping would leave stray base-coloured pixels on a recoloured body.
#
# Usage: recolor_variants.py <sprites_root> <old_root> <base> <variant> [variant ...]
import os, sys
from PIL import Image

def learn(old_root, base, variant):
    bdir, vdir = os.path.join(old_root, base), os.path.join(old_root, variant)
    lut, conflicts = {}, 0
    shared = sorted(set(os.listdir(bdir)) & set(os.listdir(vdir)))
    for f in shared:
        if not f.endswith(".png"):
            continue
        b = Image.open(os.path.join(bdir, f)).convert("RGBA")
        v = Image.open(os.path.join(vdir, f)).convert("RGBA")
        if b.size != v.size:
            continue
        bp, vp = b.load(), v.load()
        for y in range(b.height):
            for x in range(b.width):
                pb, pv = bp[x, y], vp[x, y]
                if pb[3] <= 16 and pv[3] <= 16:
                    continue
                if pb in lut and lut[pb] != pv:
                    conflicts += 1
                else:
                    lut[pb] = pv
    return lut, conflicts, len(shared)

def verify(old_root, base, variant, lut):
    """Replay the map over the OLD base frames; every pixel must land on the old variant."""
    bdir, vdir = os.path.join(old_root, base), os.path.join(old_root, variant)
    bad = total = 0
    for f in sorted(set(os.listdir(bdir)) & set(os.listdir(vdir))):
        if not f.endswith(".png"):
            continue
        b = Image.open(os.path.join(bdir, f)).convert("RGBA")
        v = Image.open(os.path.join(vdir, f)).convert("RGBA")
        if b.size != v.size:
            continue
        bp, vp = b.load(), v.load()
        for y in range(b.height):
            for x in range(b.width):
                total += 1
                if lut.get(bp[x, y], bp[x, y]) != vp[x, y]:
                    bad += 1
    return bad, total

def apply_to_new(sprites_root, base, variant, lut):
    bdir = os.path.join(sprites_root, base)
    vdir = os.path.join(sprites_root, variant)
    os.makedirs(vdir, exist_ok=True)
    # the variant is fully regenerated from the new base: stale frames from the old
    # 4-direction era would otherwise survive alongside the new 8-direction ones
    for f in os.listdir(vdir):
        if f.endswith(".png"):
            os.remove(os.path.join(vdir, f))
    # The rebuild redraws seven of the eight directions, so it can introduce shades the old
    # 4-direction palette never contained. Left unmapped those pixels keep the BASE colour —
    # white specks scattered over a blue suit. They are always near-duplicates of a colour we
    # do know, so fall back to the nearest learned source and reuse its target.
    nearest = {}
    def resolve(p):
        if p in lut:
            return lut[p], False
        if p not in nearest:
            best, bd = None, None
            for src, dst in lut.items():
                d = (src[0] - p[0]) ** 2 + (src[1] - p[1]) ** 2 + (src[2] - p[2]) ** 2
                if bd is None or d < bd:
                    bd, best = d, dst
            nearest[p] = best
        return nearest[p], True

    n = approx = 0
    for f in sorted(os.listdir(bdir)):
        if not f.endswith(".png"):
            continue
        im = Image.open(os.path.join(bdir, f)).convert("RGBA")
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                p = px[x, y]
                if p[3] <= 16:
                    continue
                colour, approximated = resolve(p)
                px[x, y] = colour
                approx += approximated
        im.save(os.path.join(vdir, f))
        n += 1
    return n, approx

if __name__ == "__main__":
    sprites_root, old_root, base = sys.argv[1], sys.argv[2], sys.argv[3]
    for variant in sys.argv[4:]:
        lut, conflicts, nshared = learn(old_root, base, variant)
        bad, total = verify(old_root, base, variant, lut)
        if conflicts or bad:
            print(f"{variant}: REJECTED — {len(lut)} colours, {conflicts} conflict(s), "
                  f"{bad}/{total} pixel(s) wrong on replay")
            continue
        n, approx = apply_to_new(sprites_root, base, variant, lut)
        print(f"{variant}: {len(lut)} colours learned from {nshared} shared frame(s), "
              f"replay exact -> wrote {n} new frame(s)"
              + (f", {approx} px via nearest shade" if approx else ""))
