#!/usr/bin/env python3
# Splice an EIGHT-direction set (rot/walk/gesture x8 from assemble8.py, blink from
# make_blink.py, cardinal sit/type) into manifest.json. The set's keys are REBUILT
# from the files on disk — a deleted frame (e.g. the dropped back-view blinks) must
# drop its key too, or drawBody swaps in a missing image. Same encoding laws as
# splice_manifest.py: utf-8, ensure_ascii=False, CRLF, every value a list.
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
MANIFEST = os.path.join(ROOT, "manifest.json")
DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

def frames_for(setname, prefix, d):
    # prefix match is underscore-terminated, so "walk_south_" never swallows "walk_south-east_"
    setdir = os.path.join(ROOT, setname)
    fs = sorted(
        (f for f in os.listdir(setdir) if f.startswith(f"{prefix}_{d}_")),
        key=lambda f: int(f.rsplit("_", 1)[1].split(".")[0]))
    return [f"{setname}/{f}" for f in fs]

def add_set8(sprites, setname):
    """Index EVERY track the set actually ships, discovered from disk.

    This used to iterate a hardcoded list of track names, which silently dropped anything not on
    it: the five `blank` colourways ship a `talk` track, and rebuilding their keys left those
    frames on disk but unindexed, so a speaking body fell back to a static pose with no error
    anywhere. Discover the names instead — a set that gains a track later is indexed for free.
    """
    setdir = os.path.join(ROOT, setname)
    for k in [k for k in sprites if k.startswith(setname + ".")]:
        del sprites[k]
    singles = {}          # (track, dir) -> filename          e.g. sit_east.png
    seqs = {}             # (track, dir) -> {index: filename} e.g. walk_east_3.png
    for f in sorted(os.listdir(setdir)):
        if not f.endswith(".png"):
            continue
        stem = f[:-4]
        m = re.match(r"([a-z]+)_(.+)_(\d+)$", stem)
        if m:
            seqs.setdefault((m.group(1), m.group(2)), {})[int(m.group(3))] = f
            continue
        m = re.match(r"([a-z]+)_(.+)$", stem)
        if m:
            singles[(m.group(1), m.group(2))] = f
    for (track, d), f in singles.items():
        sprites[f"{setname}.{track}.{d}"] = [f"{setname}/{f}"]
    for (track, d), byidx in seqs.items():       # a sequence wins over a single of the same name
        sprites[f"{setname}.{track}.{d}"] = [f"{setname}/{byidx[i]}" for i in sorted(byidx)]

if __name__ == "__main__":
    with open(MANIFEST, encoding="utf-8") as f:
        m = json.load(f)
    for setname in sys.argv[1:]:
        add_set8(m["sprites"], setname)
    with open(MANIFEST, "w", encoding="utf-8", newline="\r\n") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("spliced 8-dir:", ", ".join(sys.argv[1:]))
