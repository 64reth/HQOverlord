# Hand-crafted blink for minionchar: the Gemini state pipeline refuses the base
# image (IP filter), so paint the goggle-eye interior shut locally.
# Eye = grayish (low-saturation, not near-black) blob in the top half of the body.
# Interior pixels -> skin yellow + one dark closed-eye line; 1px gray rim kept.
import os
from PIL import Image

SET = "frontend/assets/sprites/minionchar"
SKIN = (247, 205, 90, 255)
LID = (120, 90, 30, 255)

def is_eye(px):
    r, g, b, a = px
    if a < 200:
        return False
    mx, mn = max(r, g, b), min(r, g, b)
    return (mx - mn) < 30 and mx > 45

for d in ["south", "north", "east", "west"]:
    src = os.path.join(SET, f"rot_{d}.png")
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    p = im.load()
    bb = im.getchannel("A").getbbox()
    top, bot = bb[1], bb[1] + (bb[3] - bb[1]) // 2  # head = top half
    blob = {(x, y) for y in range(top, bot) for x in range(bb[0], bb[2]) if is_eye(p[x, y])}
    if not blob:
        print(d, "no eye blob"); continue
    interior = {(x, y) for (x, y) in blob
                if all((x + dx, y + dy) in blob for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)))}
    if d == "north":  # back of head: goggle strap only, leave as-is
        im.save(os.path.join(SET, f"blink_{d}.png")); print(d, "copied (back view)"); continue
    ys = [y for (_, y) in interior]
    mid = (min(ys) + max(ys)) // 2 if ys else 0
    for (x, y) in interior:
        p[x, y] = LID if y == mid else SKIN
    im.save(os.path.join(SET, f"blink_{d}.png"))
    print(d, "blob", len(blob), "interior", len(interior))
