#!/usr/bin/env python3
# Assemble a Pixellab character (base + blink-state + sit-state) into the StarNet
# 92x92 foot-anchored frame set: rot_<dir>, blink_<dir>, sit_<dir>, walk_<dir>_<n>.
# Type animation is intentionally skipped (drawBody falls back to sit.north when working).
import os, sys, io, zipfile, urllib.request
from PIL import Image

PROJECT = "1ff7d2cf-cfe6-44f9-9533-9eea41eb05cb"
DIRS = ["south", "north", "east", "west"]
CANVAS, FOOT_Y, CX = 92, 69, 46

def fetch(url):
    for _ in range(4):
        try:
            return urllib.request.urlopen(url, timeout=90).read()
        except Exception as e:
            last = e
    raise last

def rot_url(cid, d):
    return f"https://backblaze.pixellab.ai/file/pixellab-characters/{PROJECT}/{cid}/rotations/{d}.png"

def place(frame, lock_cx=None):
    """Foot-anchor: content bottom -> FOOT_Y, content center-x -> CX (or lock_cx).
    Returns (92x92 canvas, content_center_x)."""
    a = frame.getchannel("A")
    bb = a.getbbox()
    if not bb:
        return None, None
    l, t, r, b = bb
    cx = (l + r) / 2.0
    use_cx = cx if lock_cx is None else lock_cx
    offx = round(CX - use_cx)
    offy = round(FOOT_Y - b)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(frame, (offx, offy), frame)
    return canvas, cx

def process(setname, base_id, outroot):
    outdir = os.path.join(outroot, setname)
    os.makedirs(outdir, exist_ok=True)
    z = zipfile.ZipFile(io.BytesIO(fetch(f"https://api.pixellab.ai/mcp/characters/{base_id}/download")))
    names = z.namelist()
    folders = []
    for n in names:
        top = n.split("/")[0]
        if top not in folders and "/" in n:
            folders.append(top)
    basefolder = next((f for f in folders if any(f"{f}/animations/walking/" in n for n in names)), None)
    sitfolder = next((f for f in folders if "sitting" in f.lower()), None)
    blinkfolder = next((f for f in folders if f not in (basefolder, sitfolder)), None)
    # rotations (idle) + record per-dir content center for the walk horizontal lock
    rotcx = {}
    for d in DIRS:
        im = Image.open(io.BytesIO(z.read(f"{basefolder}/rotations/{d}.png"))).convert("RGBA")
        canvas, cx = place(im)
        canvas.save(os.path.join(outdir, f"rot_{d}.png"))
        rotcx[d] = cx
    # walk (lock horizontal to the idle center so the body doesn't slide side to side)
    nwalk = 0
    for d in DIRS:
        i = 0
        while True:
            p = f"{basefolder}/animations/walking/{d}/frame_{i:03d}.png"
            if p not in names:
                break
            im = Image.open(io.BytesIO(z.read(p))).convert("RGBA")
            canvas, _ = place(im, lock_cx=rotcx[d])
            canvas.save(os.path.join(outdir, f"walk_{d}_{i}.png"))
            i += 1; nwalk += 1
    # blink + sit (grouped state rotations inside the same zip)
    nblink = nsit = 0
    for d in DIRS:
        if blinkfolder and f"{blinkfolder}/rotations/{d}.png" in names:
            im = Image.open(io.BytesIO(z.read(f"{blinkfolder}/rotations/{d}.png"))).convert("RGBA")
            place(im)[0].save(os.path.join(outdir, f"blink_{d}.png")); nblink += 1
        if sitfolder and f"{sitfolder}/rotations/{d}.png" in names:
            im = Image.open(io.BytesIO(z.read(f"{sitfolder}/rotations/{d}.png"))).convert("RGBA")
            place(im)[0].save(os.path.join(outdir, f"sit_{d}.png")); nsit += 1
    print(f"{setname}: rot=4 walk={nwalk} blink={nblink} sit={nsit}  (base={basefolder} blink={blinkfolder} sit={sitfolder})")

if __name__ == "__main__":
    _, outroot, setname, base_id = sys.argv
    process(setname, base_id, outroot)
