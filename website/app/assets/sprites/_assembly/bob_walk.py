#!/usr/bin/env python3
# Rebuild a WIDE-STANCE set's walk cycle as a bob.
#
# Pixellab's walk template needs legs to swing. Give it a character whose feet never
# separate (pikachu) and it returns six near-copies of the standing pose: measured
# frame-to-frame change is all OUTLINE, none of it structure — so the body shimmers
# in place while it slides across the floor. assets.js already knows these sets walk
# as "a bob, not a stride" (see CYCLE_PER_HEIGHT); this builds that bob explicitly.
#
# Take ONE clean frame per direction — the medoid, i.e. the frame least unlike its
# five siblings, so the generation noise that made the set shimmer is dropped rather
# than averaged — and re-key the cycle off it:
#
#   two steps per cycle, three frames each: contact (squash, planted) -> lift (stretch,
#   airborne) -> pass (neutral, settling), with a slow lean that sways once per cycle
#   so the ears and tail carry the waddle.
#
# What this must NOT do is open the foot band: assets.js measures stride length from
# the widest foot band across the walk frames and only trusts it when it beats the
# idle by 3px, which is exactly how these sets keep the documented fallback gait. A
# bob scales the whole body, never spreads the feet, so that stays true.
#
# Rejected on inspection: a per-step LEAN (rotating the body a few degrees about the
# planted foot). It looks like a waddle at master resolution and like tipping over at
# 3 degrees, but the set draws at scale 0.36 — 33px — where even 1.5 degrees moves an
# ear tip half a pixel. All it actually buys at that size is a full-body rotate
# resample that softens every frame against the crisp untouched idle. Don't re-add it.
#
# Usage: bob_walk.py <sprites_root> <set>
import os, sys
from PIL import Image, ImageChops

CANVAS, FOOT_Y = 92, 69
DIRS8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

# per-step (3 frames), repeated twice across the 6-frame cycle
LIFT = [0, 3, 1]              # px the feet leave the floor
SY = [0.96, 1.03, 1.00]       # vertical squash / stretch
SX = [1.02, 0.985, 1.00]      # width, roughly conserving volume


def medoid(frames):
    """The frame least unlike the others — the cycle's cleanest representative."""
    best, bestd = 0, None
    for i, a in enumerate(frames):
        d = 0
        for j, b in enumerate(frames):
            if i == j:
                continue
            diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB")).convert("L")
            d += sum(v for v in diff.get_flattened_data())
        if bestd is None or d < bestd:
            best, bestd = i, d
    return frames[best], best


def build_frame(src, i):
    """Squash/stretch about the planted foot, then lift it clear of the floor line."""
    lift, sy, sx = LIFT[i % 3], SY[i % 3], SX[i % 3]
    bb = src.getchannel("A").getbbox()
    content = src.crop(bb)
    nw = max(1, round(content.width * sx))
    nh = max(1, round(content.height * sy))
    content = content.resize((nw, nh), Image.LANCZOS)
    cx0 = (bb[0] + bb[2]) / 2.0
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(content, (round(cx0 - nw / 2.0), FOOT_Y - lift - nh), content)
    return out


def rebuild(root, setname):
    d = os.path.join(root, setname)
    for dr in DIRS8:
        paths = [os.path.join(d, f"walk_{dr}_{i}.png") for i in range(6)]
        paths = [p for p in paths if os.path.exists(p)]
        if len(paths) < 2:
            continue
        frames = [Image.open(p).convert("RGBA") for p in paths]
        src, which = medoid(frames)
        tops = []
        for i, p in enumerate(paths):
            f = build_frame(src, i)
            f.save(p)
            tops.append(f.getchannel("A").getbbox()[1])
        print(f"  {dr:11s} rebuilt {len(paths)} frames from frame {which}; "
              f"head travel {max(tops) - min(tops)}px")
    print(f"{setname}: bob walk rebuilt")


if __name__ == "__main__":
    rebuild(sys.argv[1], sys.argv[2])
