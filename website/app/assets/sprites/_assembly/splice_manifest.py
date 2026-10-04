#!/usr/bin/env python3
# Splice new skin sets into manifest.json. MUST keep utf-8 + ensure_ascii=False +
# newline='\n' (Windows cp1252 default mangles unicode elsewhere in repo JSON).
import json, os, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
MANIFEST = os.path.join(ROOT, "manifest.json")
DIRS = ["south", "north", "east", "west"]

def add_set(sprites, setname):
    setdir = os.path.join(ROOT, setname)
    for d in DIRS:
        # every value MUST be a list — assets.js init() does paths.map() on each
        sprites[f"{setname}.rot.{d}"] = [f"{setname}/rot_{d}.png"]
        walks = sorted(
            (f for f in os.listdir(setdir) if f.startswith(f"walk_{d}_")),
            key=lambda f: int(f.rsplit("_", 1)[1].split(".")[0]))
        sprites[f"{setname}.walk.{d}"] = [f"{setname}/{f}" for f in walks]
        # sit/blink may be absent (e.g. content-policy-blocked states); drawBody
        # falls back sit->rot and skips blink when the key is missing.
        for state in ("sit", "blink"):
            if os.path.exists(os.path.join(setdir, f"{state}_{d}.png")):
                sprites[f"{setname}.{state}.{d}"] = [f"{setname}/{state}_{d}.png"]

if __name__ == "__main__":
    with open(MANIFEST, encoding="utf-8") as f:
        m = json.load(f)
    for setname in sys.argv[1:]:
        add_set(m["sprites"], setname)
    # manifest.json is stored CRLF in git — match it so the diff stays additive
    with open(MANIFEST, "w", encoding="utf-8", newline="\r\n") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("spliced:", ", ".join(sys.argv[1:]))
