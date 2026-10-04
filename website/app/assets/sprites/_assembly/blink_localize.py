#!/usr/bin/env python3
# Make every blink change ONLY the eyes.
#
# A blink is shown for ~130ms on top of the idle pose, so anything else that differs between the
# two frames flickers for that instant. The shipped blinks were generated as whole separate
# renders rather than edits of the idle, so they disagree with it all over the body: caseyjones
# differs on 43% of its pixels, pikachu 27%, and pepe's entire body sits one pixel up and left.
# The eyes close correctly in all of them — it is everything else that moves.
#
# Fix without new art: rebuild each blink AS the idle frame with only the eye-region change
# painted in. Because the result starts from the idle, placement is inherited exactly (pepe's
# offset disappears), and because only the densest upper cluster of changed pixels is kept, the
# body-wide noise disappears with it.
#
# Finding the eyes without a per-skin rule: the blink's changed pixels are dense where the eyes
# are and sparse everywhere else, so take the row band holding the heaviest run of change within
# the upper half of the body. Sets whose change is not concentrated at all are left untouched
# rather than guessed at.
import os, sys
from PIL import Image

D8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

def localize(rot_p, blink_p):
    rot = Image.open(rot_p).convert("RGBA")
    blk = Image.open(blink_p).convert("RGBA")
    if rot.size != blk.size:
        return None, "size mismatch"
    rb = rot.getchannel("A").getbbox()
    bb = blk.getchannel("A").getbbox()
    if not rb or not bb:
        return None, "empty"
    # align: the blink may be authored at a different offset than the idle
    off = (bb[0] - rb[0], bb[1] - rb[1])
    if off != (0, 0):
        blk = blk.transform(blk.size, Image.AFFINE, (1, 0, off[0], 0, 1, off[1]))
    rp, bp = rot.load(), blk.load()
    top, bot = rb[1], rb[3]
    height = bot - top
    if height < 6:
        return None, "too small"
    rows = {}
    for y in range(rot.height):
        n = sum(1 for x in range(rot.width) if rp[x, y] != bp[x, y])
        if n:
            rows[y] = n
    if not rows:
        return None, "no change"
    # eyes live in the upper half; find the heaviest 5-row window there
    lo_lim, hi_lim = top, top + int(height * 0.55)
    best_y, best_w = None, -1
    for y in range(lo_lim, max(lo_lim + 1, hi_lim)):
        w = sum(rows.get(yy, 0) for yy in range(y - 2, y + 3))
        if w > best_w:
            best_w, best_y = w, y
    if best_w <= 0:
        return None, "no upper change"
    band = range(max(0, best_y - 3), min(rot.height, best_y + 4))
    out = rot.copy()
    op = out.load()
    kept = 0
    for y in band:
        for x in range(rot.width):
            if rp[x, y] != bp[x, y]:
                op[x, y] = bp[x, y]
                kept += 1
    if kept == 0:
        return None, "nothing kept"
    total = sum(rows.values())
    return out, f"kept {kept}/{total}px in rows {band.start}-{band.stop - 1}"

if __name__ == "__main__":
    root = sys.argv[1]
    for setname in sys.argv[2:]:
        d = os.path.join(root, setname)
        if not os.path.isdir(d):
            continue
        notes = []
        for dd in D8:
            rp = os.path.join(d, f"rot_{dd}.png")
            bp = os.path.join(d, f"blink_{dd}.png")
            if not (os.path.exists(rp) and os.path.exists(bp)):
                continue
            out, why = localize(rp, bp)
            if out is None:
                notes.append(f"{dd}: SKIPPED ({why})")
            else:
                out.save(bp)
                notes.append(f"{dd}: {why}")
        print(f"{setname}: " + " | ".join(notes) if notes else f"{setname}: no blink")
