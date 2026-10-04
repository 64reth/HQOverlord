#!/usr/bin/env python3
# Bring a set's WALK track back onto the same build as its idle.
#
# assemble8 foot-anchors every frame independently, so it happily accepts a walk
# animation Pixellab rendered at a different scale from the rotations — the frames
# all sit on the floor line, they are just a different SIZE. The result is a body
# that changes build the moment it steps (skeleton shipped 28-38% taller walking
# than standing). Across the healthy roster max(walk content height) / rot content
# height sits in 0.96-1.08, so that ratio is the thing to restore.
#
# ONE scale factor per direction, applied to every frame of that direction, scaled
# about the foot anchor (CX, FOOT_Y). Uniform means the cycle's own motion — bob,
# stride, arm swing — survives untouched; only the build changes. Per-direction
# means each direction lands on ITS own idle, which is what keeps a turn-in-place
# from popping.
#
# Usage: fit_walk_to_idle.py <sprites_root> <set> [target_ratio]
import os, sys
from PIL import Image

CANVAS, FOOT_Y, CX = 92, 69, 46
DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]


def bbox(path):
    return Image.open(path).convert("RGBA").getchannel("A").getbbox()


def scale_about_anchor(path, k):
    """Resample the whole frame by k, keeping the point (CX, FOOT_Y) fixed."""
    im = Image.open(path).convert("RGBA")
    nw, nh = max(1, round(im.width * k)), max(1, round(im.height * k))
    small = im.resize((nw, nh), Image.LANCZOS)
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(small, (round(CX - CX * k), round(FOOT_Y - FOOT_Y * k)), small)
    out.save(path)


def fit(root, setname, target):
    d = os.path.join(root, setname)
    report = []
    for dr in DIRS8:
        rot = os.path.join(d, f"rot_{dr}.png")
        walks = [os.path.join(d, f"walk_{dr}_{i}.png") for i in range(16)]
        walks = [p for p in walks if os.path.exists(p)]
        if not os.path.exists(rot) or not walks:
            continue
        rb = bbox(rot)
        rot_h = rb[3] - rb[1]
        tallest = max((bbox(p)[3] - bbox(p)[1]) for p in walks)
        k = target * rot_h / tallest
        if abs(k - 1) < 0.02:          # already on-build; resampling would only soften it
            report.append(f"  {dr:11s} ratio={tallest/rot_h:.3f} — left alone")
            continue
        for p in walks:
            scale_about_anchor(p, k)
        after = max((bbox(p)[3] - bbox(p)[1]) for p in walks)
        report.append(f"  {dr:11s} {tallest}->{after} vs rot {rot_h}  k={k:.4f}  "
                      f"ratio {tallest/rot_h:.3f}->{after/rot_h:.3f}")
    print(f"{setname}: walk fitted to idle (target max/rot={target})")
    print("\n".join(report))


if __name__ == "__main__":
    root, setname = sys.argv[1], sys.argv[2]
    fit(root, setname, float(sys.argv[3]) if len(sys.argv) > 3 else 1.03)
