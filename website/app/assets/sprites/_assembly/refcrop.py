#!/usr/bin/env python3
# Emit a v3 REFERENCE crop (base64 PNG) for each named set, taken from the set's SHIPPED
# rot_south.png. Feeding Pixellab the art that is actually on screen today is what keeps a
# rebuilt set recognisably the same character — it needs no Pixellab character id at all, so
# it also works for the five skins whose current art came from a state-edit whose id nobody
# wrote down (docs/SKIN_POLISH_PLAN.md resolves only 27 of 36).
#
# The crop is TIGHT + squared: a 92x92 master is mostly transparent padding, and inline base64
# is truncated by MCP clients somewhere above a couple of KB. Cropping to content takes a ~1.3KB
# PNG (~1.7K base64 chars) instead of ~4KB, which transports intact. Pixellab then sizes the
# output from the reference's own dimensions, so each skin keeps its own build.
import os, sys, io, base64
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")

def to_palette(im):
    """RGBA -> indexed PNG, index 0 transparent. Pixel art has binary alpha and a few dozen
    colours, so this is LOSSLESS and roughly halves the byte count. That matters: the base64
    rides inside a tool argument, and oversized values get silently truncated in transit
    (two of the first ten sets came back 'broken data stream'). Smaller payload, fewer retries."""
    px = im.load()
    idx, order = {}, []
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if p[3] > 16 and p[:3] not in idx:
                idx[p[:3]] = len(order) + 1          # 0 is reserved for transparent
                order.append(p[:3])
    if len(order) > 255:
        return None
    out = Image.new("P", im.size, 0)
    opx = out.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            opx[x, y] = idx[p[:3]] if p[3] > 16 else 0
    palette = [0, 0, 0]
    for c in order:
        palette += list(c)
    out.putpalette(palette + [0] * (768 - len(palette)))
    return out

def ref_b64(setname, pad=4):
    im = Image.open(os.path.join(ROOT, setname, "rot_south.png")).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    c = im.crop(bb)
    side = max(c.width, c.height) + pad
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(c, ((side - c.width) // 2, (side - c.height) // 2), c)
    buf = io.BytesIO()
    pal = to_palette(sq)
    if pal is not None:
        pal.save(buf, format="PNG", optimize=True, transparency=0)
    else:
        sq.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode(), c.size, side, len(buf.getvalue())

if __name__ == "__main__":
    outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)
    for setname in sys.argv[2:]:
        b64, content, side, nbytes = ref_b64(setname)
        with open(os.path.join(outdir, f"ref_{setname}.b64"), "w") as f:
            f.write(b64)
        print(f"{setname}: content={content[0]}x{content[1]} square={side} png={nbytes}B b64={len(b64)}c")
