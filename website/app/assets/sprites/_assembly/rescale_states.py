#!/usr/bin/env python3
# One-off for an 8-dir rebuild whose new master content height differs from the old
# set's: resample the KEPT old-state frames (sit/type/blink) to the new content
# height so the single per-set DATA.SKINS scale renders every state at the same
# on-floor size (otherwise the body visibly grows on sit-down). Smooth resample is
# fine here: these are 92px masters drawn down to ~17px at draw time.
import os, sys
from PIL import Image

CANVAS, FOOT_Y, CX = 92, 69, 46

def place(frame, lock_cx=None):
    a = frame.getchannel("A")
    bb = a.getbbox()
    if not bb:
        return None
    l, t, r, b = bb
    cx = (l + r) / 2.0
    use_cx = cx if lock_cx is None else lock_cx
    offx = round(CX - use_cx)
    offy = round(FOOT_Y - b)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(frame, (offx, offy), frame)
    return canvas

def rescale(path, k):
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    if not bb:
        return
    content = im.crop(bb)
    nw, nh = max(1, round(content.width * k)), max(1, round(content.height * k))
    content = content.resize((nw, nh), Image.LANCZOS)
    out = place(content)
    if out:
        out.save(path)

if __name__ == "__main__":
    setdir, k = sys.argv[1], float(sys.argv[2])
    n = 0
    for f in sorted(os.listdir(setdir)):
        if f.startswith(("sit_", "type_", "blink_")) and f.endswith(".png"):
            rescale(os.path.join(setdir, f), k)
            n += 1
    print(f"rescaled {n} state frames by {k}")
