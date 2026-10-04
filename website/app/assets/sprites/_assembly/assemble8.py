#!/usr/bin/env python3
# Assemble an EIGHT-direction Pixellab character into the StarNet 92x92 foot-anchored
# frame set: rot_<dir> x8, walk_<dir>_<n> x8 dirs, gesture_<dir>_<n> x8 dirs.
# Companion to assemble.py (4-dir, blink/sit states) — this one is for the v3 8-dir
# rebuilds where blink/sit/type stay on the shipped cardinal frames.
# The gesture track keeps Pixellab's frame_000 (the rot reference pose) as frame 0 so
# the one-shot playback in drawBody departs FROM the standing pose.
import os, sys, io, zipfile, urllib.request
from PIL import Image

DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
CANVAS, FOOT_Y, CX = 92, 69, 46

def fetch(url):
    last = None
    for _ in range(4):
        try:
            return urllib.request.urlopen(url, timeout=120).read()
        except Exception as e:
            last = e
    raise last

def place(frame, lock_cx=None):
    """Foot-anchor: content bottom -> FOOT_Y, content center-x -> CX (or lock_cx)."""
    a = frame.getchannel("A")
    bb = a.getbbox()
    if not bb:
        return None, None, 0
    l, t, r, b = bb
    cx = (l + r) / 2.0
    use_cx = cx if lock_cx is None else lock_cx
    offx = round(CX - use_cx)
    offy = round(FOOT_Y - b)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(frame, (offx, offy), frame)
    return canvas, cx, (b - t)

def process(setname, char_id, outroot):
    outdir = os.path.join(outroot, setname)
    os.makedirs(outdir, exist_ok=True)
    z = zipfile.ZipFile(io.BytesIO(fetch(f"https://api.pixellab.ai/mcp/characters/{char_id}/download")))
    names = z.namelist()
    folders = sorted({n.split("/")[0] for n in names if "/" in n})
    base = next((f for f in folders if any(n.startswith(f + "/rotations/") for n in names)), None)
    if not base:
        sys.exit(f"no rotations folder in zip (folders: {folders})")
    # animation folders under <base>/animations/<anim>/<dir>/frame_XXX.png
    anims = sorted({n.split("/")[2] for n in names if n.startswith(base + "/animations/") and n.count("/") >= 4})
    walk_anim = next((a for a in anims if "walk" in a.lower()), None)
    gest_anim = next((a for a in anims if a != walk_anim), None)
    # rotations + per-dir content center for the walk/gesture horizontal lock
    rotcx, hmax = {}, 0
    for d in DIRS8:
        im = Image.open(io.BytesIO(z.read(f"{base}/rotations/{d}.png"))).convert("RGBA")
        canvas, cx, h = place(im)
        canvas.save(os.path.join(outdir, f"rot_{d}.png"))
        rotcx[d] = cx
        hmax = max(hmax, h)
    counts = {}
    for anim, prefix in ((walk_anim, "walk"), (gest_anim, "gesture")):
        if not anim:
            continue
        counts[prefix] = 0
        for d in DIRS8:
            i = 0
            while True:
                p = f"{base}/animations/{anim}/{d}/frame_{i:03d}.png"
                if p not in names:
                    break
                im = Image.open(io.BytesIO(z.read(p))).convert("RGBA")
                place(im, lock_cx=rotcx[d])[0].save(os.path.join(outdir, f"{prefix}_{d}_{i}.png"))
                i += 1
                counts[prefix] += 1
    print(f"{setname}: rot=8 content_h={hmax} anims={anims} " +
          " ".join(f"{k}={v}" for k, v in counts.items()))

if __name__ == "__main__":
    _, outroot, setname, char_id = sys.argv
    process(setname, char_id, outroot)
