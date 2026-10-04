#!/usr/bin/env python3
# Blink frames derived FROM the v2 rotation masters (not regenerated): the old bear's blink
# states had different per-direction proportions (up to 4px taller than the v2 rots), so the
# face jumped every blink. Editing the placed 92x92 rot master shuts the eyes with ZERO
# geometry change — alignment is perfect by construction and it costs no generations.
#
# Eye finder: dark interior clusters in the upper head band. The silhouette outline is dark
# too but touches transparency; the nose is dark but sits in the cream muzzle lower down.
# So: dark pixel + not adjacent to alpha=0 + in the top 45% of the content box = eye.
# Close = fill with the fur color sampled above the eye + a 1px darker lid line on the
# cluster's bottom row. Directions whose view shows no eyes (north-ish) are skipped.
import os, sys
from PIL import Image

# eye-visible views only: the three north-facing rotations are back/back-quarter views where
# a blink is invisible — shipping one just risks editing non-eye pixels.
DIRS = ["south", "south-east", "east", "west", "south-west"]

def clusters(px, w, h, box):
    l, t, r, b = box
    ch = b - t
    band_t, band_b = t + int(ch * 0.20), t + int(ch * 0.48)   # below the ears, above the muzzle
    dark, seen, out = set(), set(), []
    def a(x, y): return px[x, y][3]
    for y in range(band_t, band_b):
        for x in range(l, r):
            p = px[x, y]
            if p[3] > 16 and p[0] < 95 and p[1] < 85 and p[2] < 85:
                edge = False
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    if a(x+dx, y+dy) <= 16: edge = True; break
                if not edge: dark.add((x, y))
    for s in dark:
        if s in seen: continue
        st, comp = [s], set()
        while st:
            c = st.pop()
            if c in seen: continue
            seen.add(c); comp.add(c)
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    n = (c[0]+dx, c[1]+dy)
                    if n in dark and n not in seen: st.append(n)
        if not (2 <= len(comp) <= 24): continue
        # the nose/mouth lives in the cream muzzle: reject clusters whose surrounding
        # ring is creamy; eyes are ringed by mid-tan fur.
        ring_cream = ring_all = 0
        for (cx, cy) in comp:
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    n = (cx+dx, cy+dy)
                    if n in comp: continue
                    p = px[n[0], n[1]]
                    if p[3] > 16:
                        ring_all += 1
                        if p[0] > 200 and p[1] > 175: ring_cream += 1
        if ring_all and ring_cream / ring_all > 0.25: continue
        # eyes are square-ish or tall (2-3px wide dots); the MOUTH is a wide flat line
        xs = [c[0] for c in comp]; ys = [c[1] for c in comp]
        cw, chh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if cw / chh > 2: continue
        out.append(comp)
    # a face has at most two eyes — keep the two largest, drop stray shading specks
    out.sort(key=len, reverse=True)
    return out[:2]

def close_eyes(path, out_path):
    im = Image.open(path).convert("RGBA")
    px = im.load()
    box = im.getchannel("A").getbbox()
    if not box: return 0
    eyes = clusters(px, im.width, im.height, box)
    if not eyes: return 0
    for comp in eyes:
        top = min(y for _, y in comp); bot = max(y for _, y in comp)
        for (x, y) in comp:
            # fur sample: first non-dark opaque pixel straight up
            fy = y - 1
            while fy > 0 and (px[x, fy][3] <= 16 or (px[x, fy][0] < 95 and px[x, fy][1] < 85)):
                fy -= 1
            fur = px[x, fy] if px[x, fy][3] > 16 else (181, 129, 97, 255)
            px[x, y] = (fur[0], fur[1], fur[2], 255)
        # closed lid: 1px line across the cluster's bottom row, a darkened fur tone
        for (x, y) in comp:
            if y == bot:
                f = px[x, y]
                px[x, y] = (int(f[0]*0.62), int(f[1]*0.60), int(f[2]*0.60), 255)
    im.save(out_path)
    return len(eyes)

if __name__ == "__main__":
    root = sys.argv[1]
    for d in DIRS:
        src = os.path.join(root, f"rot_{d}.png")
        dst = os.path.join(root, f"blink_{d}.png")
        if not os.path.exists(src): continue
        n = close_eyes(src, dst)
        if n == 0 and os.path.exists(dst) and d.startswith("north") is False:
            pass
        print(f"{d}: {n} eye cluster(s)" + ("" if n else " — no blink written" if not os.path.exists(dst) else " — left existing"))
