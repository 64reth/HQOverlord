#!/usr/bin/env python3
# Drive a full 8-direction rebuild for many skins at once.
#
# Per set: assemble8 (rot x8, walk x8, gesture x4) -> blink_from_old (free, derived) ->
# report any size drift against the shipped art. sit/type frames are LEFT ALONE: v3
# reference mode passes the south view through pixel-for-pixel (measured 0/640 different
# on skeleton), so the set's build — and therefore its DATA.SKINS scale — is unchanged.
# That is the whole reason this rebuild needs no scale renormalisation, unlike the bear,
# which was seeded from a padded canvas and came back 15% shorter.
#
# Usage: rebuild_sets.py <sprites_root> <old_root> <charmap.json> [set ...]
import json, os, shutil, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

def content(path):
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    return None if not bb else (bb[2] - bb[0], bb[3] - bb[1])

class NotReady(Exception):
    pass

def run(script, *args):
    r = subprocess.run([sys.executable, os.path.join(HERE, script), *args],
                       capture_output=True, text=True)
    if r.returncode != 0:
        # Pixellab serves the character ZIP only once every queued job has landed, so a set
        # whose walk is still generating simply is not ready yet. Skip it and keep going —
        # this script is re-run as the batch drains, and one pending set must not abort the
        # sets behind it.
        raise NotReady(f"{script}: {(r.stderr or r.stdout).strip().splitlines()[-1][:120]}")
    return r.stdout.strip()

DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

def restore(sprites_root, old_root, setname):
    """Put the set back exactly as shipped."""
    dst = os.path.join(sprites_root, setname)
    src = os.path.join(old_root, setname)
    for f in os.listdir(dst):
        if f.endswith(".png"):
            os.remove(os.path.join(dst, f))
    for f in os.listdir(src):
        if f.endswith(".png"):
            shutil.copy2(os.path.join(src, f), os.path.join(dst, f))

def rebuild(sprites_root, old_root, setname, char_id):
    before = content(os.path.join(old_root, setname, "rot_south.png"))
    out = run("assemble8.py", sprites_root, setname, char_id)
    # The ZIP downloads as soon as the ROTATIONS exist, but a set whose walk is still
    # generating comes back with rotations only — leaving new 8-direction idles beside the
    # OLD 4-direction walk frames, which is a body that changes build the moment it steps.
    # Refuse that state outright and put the set back as shipped until the walk lands.
    setdir = os.path.join(sprites_root, setname)
    missing = [d for d in DIRS8 if not os.path.exists(os.path.join(setdir, f"walk_{d}_0.png"))]
    if missing:
        restore(sprites_root, old_root, setname)
        raise NotReady(f"walk missing for {len(missing)}/8 directions — set restored")
    print(out)
    after = content(os.path.join(setdir, "rot_south.png"))
    drift = "" if before == after else f"  *** SOUTH DRIFT {before} -> {after} ***"
    print(run("blink_from_old.py", sprites_root, old_root, setname) + drift)
    return before == after

if __name__ == "__main__":
    sprites_root, old_root, mapfile = sys.argv[1], sys.argv[2], sys.argv[3]
    charmap = json.load(open(mapfile))
    wanted = sys.argv[4:] or sorted(charmap)
    ok, drifted, pending = [], [], []
    for s in wanted:
        if s not in charmap:
            print(f"{s}: NO CHARACTER ID — skipped"); continue
        try:
            (ok if rebuild(sprites_root, old_root, s, charmap[s]) else drifted).append(s)
        except NotReady as e:
            pending.append(s)
            print(f"{s}: not ready ({e})")
    print(f"\nrebuilt {len(ok)} set(s) with no south drift")
    if drifted:
        print(f"SOUTH DRIFT on: {', '.join(drifted)} — check scale before shipping")
    if pending:
        print(f"still generating: {', '.join(pending)}")
