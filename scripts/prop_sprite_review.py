#!/usr/bin/env python3
"""Generate mask-locked review sprites from existing furniture PNGs.

This is intentionally review-only. It writes polished variants, templates, and
a manifest under docs/prop-sprite-review without touching the runtime catalog.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "frontend" / "assets" / "furniture"
DEFAULT_OUT = ROOT / "docs" / "prop-sprite-review"
PIXELS_PER_TILE = 48

SAMPLES = [
    "desk2",
    "pixelrig",
    "holotable",
    "crate",
    "plant",
    "arcade",
    "vault",
    "whiteboard",
]


def load_catalog() -> dict[str, dict]:
    js = """
const P = require('./frontend/app/propsprites.js');
const lite = P.CATALOG.map(c => ({
  id: c.id, label: c.label, cat: c.cat, tier: c.tier,
  w: c.w || 1, h: c.h || 1, blocks: c.blocks !== false,
  animated: !!c.animated, seat: !!c.seat
}));
console.log(JSON.stringify(lite));
"""
    out = subprocess.check_output(
        ["node", "-e", js],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
    )
    return {c["id"]: c for c in json.loads(out)}


def clamp(v: float) -> int:
    return max(0, min(255, int(round(v))))


def blend(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        clamp(a[0] + (b[0] - a[0]) * t),
        clamp(a[1] + (b[1] - a[1]) * t),
        clamp(a[2] + (b[2] - a[2]) * t),
    )


def shade(rgb: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    target = (255, 255, 255) if amount >= 0 else (0, 0, 0)
    return blend(rgb, target, abs(amount))


def alpha_hash(img: Image.Image) -> str:
    return hashlib.sha256(img.getchannel("A").tobytes()).hexdigest()


def color_hash(img: Image.Image) -> str:
    return hashlib.sha256(img.convert("RGBA").tobytes()).hexdigest()


def masked_px(img: Image.Image, x: int, y: int, rgb: tuple[int, int, int], strength: float = 1.0) -> None:
    if x < 0 or y < 0 or x >= img.width or y >= img.height:
        return
    r, g, b, a = img.getpixel((x, y))
    if a == 0:
        return
    nr, ng, nb = blend((r, g, b), rgb, strength)
    img.putpixel((x, y), (nr, ng, nb, a))


def masked_rect(img: Image.Image, box: tuple[int, int, int, int], rgb: tuple[int, int, int], strength: float = 1.0) -> None:
    x1, y1, x2, y2 = box
    for y in range(y1, y2):
        for x in range(x1, x2):
            masked_px(img, x, y, rgb, strength)


def masked_line(img: Image.Image, x1: int, y1: int, x2: int, y2: int, rgb: tuple[int, int, int], strength: float = 1.0) -> None:
    dx = abs(x2 - x1)
    dy = -abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    err = dx + dy
    x, y = x1, y1
    while True:
        masked_px(img, x, y, rgb, strength)
        if x == x2 and y == y2:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy


def masked_outline(img: Image.Image, box: tuple[int, int, int, int], rgb: tuple[int, int, int], strength: float = 1.0) -> None:
    x1, y1, x2, y2 = box
    masked_line(img, x1, y1, x2 - 1, y1, rgb, strength)
    masked_line(img, x1, y2 - 1, x2 - 1, y2 - 1, rgb, strength)
    masked_line(img, x1, y1, x1, y2 - 1, rgb, strength)
    masked_line(img, x2 - 1, y1, x2 - 1, y2 - 1, rgb, strength)


def edge_and_contrast(src: Image.Image) -> Image.Image:
    img = src.convert("RGBA").copy()
    pix = src.convert("RGBA").load()
    alpha = src.getchannel("A").load()
    out = img.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = pix[x, y]
            if a == 0:
                continue
            nr = clamp((r - 128) * 1.08 + 128)
            ng = clamp((g - 128) * 1.08 + 128)
            nb = clamp((b - 128) * 1.08 + 128)
            here = (nr, ng, nb)
            top = y == 0 or alpha[x, y - 1] == 0
            left = x == 0 or alpha[x - 1, y] == 0
            bottom = y == src.height - 1 or alpha[x, y + 1] == 0
            right = x == src.width - 1 or alpha[x + 1, y] == 0
            if top or left:
                here = shade(here, 0.18)
            if bottom or right:
                here = shade(here, -0.30)
            out[x, y] = (*here, a)
    return img


def apply_detail_pass(img: Image.Image, prop_id: str, bbox: tuple[int, int, int, int]) -> None:
    x1, y1, x2, y2 = bbox
    w, h = x2 - x1, y2 - y1
    hi = (214, 245, 238)
    glow = (76, 255, 167)
    cyan = (80, 217, 255)
    amber = (255, 200, 86)
    red = (255, 82, 82)
    dark = (7, 10, 12)
    metal = (118, 143, 150)
    wood = (157, 100, 50)
    leaf = (86, 218, 122)

    if prop_id in {"desk2", "pixelrig"}:
        for i in range(3):
            sx = x1 + 12 + i * max(10, w // 5)
            masked_rect(img, (sx, y1 + 6, sx + max(5, w // 9), y1 + 13), cyan, 0.55)
            masked_line(img, sx + 1, y1 + 8, sx + max(4, w // 9) - 1, y1 + 8, dark, 0.45)
        masked_line(img, x1 + 9, y2 - 10, x2 - 10, y2 - 10, metal, 0.55)
        for i in range(8):
            bx = x1 + 12 + i * max(5, w // 12)
            masked_px(img, bx, y2 - 7, glow if i % 3 else amber, 0.8)
        masked_outline(img, (x1 + 5, y1 + 5, x2 - 5, y2 - 5), hi, 0.12)

    elif prop_id == "holotable":
        cy = y1 + h // 2
        for off in range(-18, 19, 9):
            masked_line(img, x1 + 18, cy + off // 2, x2 - 18, cy - off // 2, cyan, 0.38)
        for off in range(-34, 35, 17):
            masked_line(img, x1 + w // 2 + off, y1 + 18, x1 + w // 2 - off, y2 - 15, glow, 0.28)
        masked_rect(img, (x1 + w // 2 - 7, cy - 4, x1 + w // 2 + 7, cy + 4), (156, 255, 226), 0.7)
        for i in range(7):
            masked_px(img, x1 + 28 + i * 10, y2 - 12, amber if i % 2 else cyan, 0.7)

    elif prop_id == "crate":
        for y in (y1 + h // 3, y1 + 2 * h // 3):
            masked_line(img, x1 + 4, y, x2 - 5, y, wood, 0.55)
            masked_line(img, x1 + 4, y + 1, x2 - 5, y + 1, dark, 0.25)
        masked_line(img, x1 + 8, y1 + 8, x2 - 9, y2 - 9, shade(wood, 0.18), 0.45)
        for px in (x1 + 7, x2 - 8):
            for py in (y1 + 8, y2 - 9):
                masked_px(img, px, py, amber, 0.9)
                masked_px(img, px + 1, py + 1, dark, 0.45)

    elif prop_id == "plant":
        for dx in (-9, -5, 0, 5, 9):
            masked_line(img, x1 + w // 2, y1 + h // 2, x1 + w // 2 + dx, y1 + 5 + abs(dx) // 2, leaf, 0.62)
            masked_px(img, x1 + w // 2 + dx, y1 + 5 + abs(dx) // 2, shade(leaf, 0.35), 0.8)
        masked_line(img, x1 + 5, y2 - 11, x2 - 6, y2 - 11, amber, 0.45)
        masked_line(img, x1 + 7, y2 - 6, x2 - 8, y2 - 6, dark, 0.35)

    elif prop_id == "arcade":
        masked_rect(img, (x1 + 10, y1 + 12, x2 - 10, y1 + 24), amber, 0.55)
        masked_rect(img, (x1 + 14, y1 + 34, x2 - 14, y1 + 55), cyan, 0.55)
        for yy in range(y1 + 37, min(y1 + 54, y2), 4):
            masked_line(img, x1 + 15, yy, x2 - 15, yy, dark, 0.35)
        for i, col in enumerate((red, glow, amber)):
            masked_px(img, x1 + 18 + i * 6, y2 - 30, col, 0.9)
            masked_px(img, x1 + 18 + i * 6, y2 - 29, col, 0.65)
        masked_line(img, x1 + 5, y1 + 8, x1 + 5, y2 - 7, hi, 0.18)

    elif prop_id == "vault":
        cx, cy = x1 + w // 2, y1 + h // 2
        for r in (26, 18, 10):
            masked_outline(img, (cx - r, cy - r, cx + r, cy + r), metal, 0.2)
        for dx, dy in ((-24, -24), (24, -24), (-24, 24), (24, 24), (0, -31), (0, 31)):
            masked_px(img, cx + dx, cy + dy, amber, 0.85)
            masked_px(img, cx + dx + 1, cy + dy + 1, dark, 0.35)
        masked_rect(img, (cx - 4, cy - 4, cx + 5, cy + 5), hi, 0.45)
        masked_line(img, cx, cy - 18, cx, cy + 18, dark, 0.3)

    elif prop_id == "whiteboard":
        for yy in range(y1 + 7, y2 - 6, 8):
            masked_line(img, x1 + 10, yy, x2 - 10, yy, (63, 141, 128), 0.26)
        for i in range(5):
            sx = x1 + 15 + i * max(10, w // 8)
            masked_line(img, sx, y2 - 13 - (i % 3) * 3, sx + 9, y2 - 17 + (i % 2) * 5, glow if i % 2 else amber, 0.75)
        masked_rect(img, (x2 - 24, y1 + 8, x2 - 14, y1 + 17), amber, 0.65)
        masked_rect(img, (x2 - 36, y1 + 11, x2 - 27, y1 + 20), red, 0.45)

    seed = int(hashlib.sha256(prop_id.encode("utf-8")).hexdigest()[:8], 16)
    for i in range(max(6, (w * h) // 420)):
        hx = (seed + i * 1103515245) & 0x7FFFFFFF
        x = x1 + 2 + hx % max(1, w - 4)
        y = y1 + 2 + ((hx >> 9) % max(1, h - 4))
        masked_px(img, x, y, hi if i % 3 == 0 else dark, 0.18)


def make_template(src: Image.Image, spec: dict | None, bbox: tuple[int, int, int, int] | None) -> Image.Image:
    tpl = Image.new("RGBA", src.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(tpl)
    for y in range(0, src.height, PIXELS_PER_TILE):
        draw.line((0, y, src.width, y), fill=(58, 230, 173, 105))
    for x in range(0, src.width, PIXELS_PER_TILE):
        draw.line((x, 0, x, src.height), fill=(58, 230, 173, 105))
    draw.rectangle((0, 0, src.width - 1, src.height - 1), outline=(255, 255, 255, 155))
    if spec:
        fw = min(src.width - 1, spec["w"] * PIXELS_PER_TILE - 1)
        fh = min(src.height - 1, spec["h"] * PIXELS_PER_TILE - 1)
        draw.rectangle((0, 0, fw, fh), outline=(255, 204, 76, 220), width=2)
    if bbox:
        draw.rectangle((bbox[0], bbox[1], bbox[2] - 1, bbox[3] - 1), outline=(94, 197, 255, 210), width=1)
    alpha = src.getchannel("A")
    edge = alpha.filter(ImageFilter.FIND_EDGES)
    tpl.alpha_composite(Image.merge("RGBA", (
        Image.new("L", src.size, 255),
        Image.new("L", src.size, 255),
        Image.new("L", src.size, 255),
        edge.point(lambda p: min(170, p)),
    )))
    return tpl


def checker(size: tuple[int, int], cell: int = 8) -> Image.Image:
    img = Image.new("RGBA", size, (18, 22, 27, 255))
    draw = ImageDraw.Draw(img)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(27, 33, 39, 255))
    return img


def card(img: Image.Image, title: str, max_w: int = 210, max_h: int = 130) -> Image.Image:
    scale = min(max_w / img.width, max_h / img.height, 3)
    scale = max(1, int(scale))
    shown = img.resize((img.width * scale, img.height * scale), Image.Resampling.NEAREST)
    pad, title_h = 10, 18
    out = Image.new("RGBA", (max_w + pad * 2, max_h + pad * 2 + title_h), (10, 13, 16, 255))
    bg = checker((max_w, max_h), 10)
    out.alpha_composite(bg, (pad, pad + title_h))
    ox = pad + (max_w - shown.width) // 2
    oy = pad + title_h + (max_h - shown.height) // 2
    out.alpha_composite(shown, (ox, oy))
    draw = ImageDraw.Draw(out)
    draw.text((pad, 4), title, fill=(226, 238, 234, 255), font=ImageFont.load_default())
    draw.rectangle((pad, pad + title_h, pad + max_w - 1, pad + title_h + max_h - 1), outline=(66, 82, 91, 255))
    return out


def make_review_sheet(rows: list[dict], out_path: Path) -> None:
    row_h = 178
    left_w = 160
    col_w = 230
    width = left_w + col_w * 3 + 28
    height = 46 + row_h * len(rows)
    sheet = Image.new("RGBA", (width, height), (8, 11, 14, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((14, 14), "Prop sprite review - originals vs mask-locked polished samples", fill=(232, 244, 239, 255), font=font)
    draw.text((left_w + 20, 30), "Original", fill=(138, 163, 172, 255), font=font)
    draw.text((left_w + 20 + col_w, 30), "Polished", fill=(138, 163, 172, 255), font=font)
    draw.text((left_w + 20 + col_w * 2, 30), "Template", fill=(138, 163, 172, 255), font=font)
    for idx, row in enumerate(rows):
        y = 48 + idx * row_h
        spec = row["spec"]
        spec_line = "no catalog spec"
        if spec:
            spec_line = f'{spec["w"]}x{spec["h"]} tiles, {spec["cat"]}'
        draw.text((14, y + 16), row["id"], fill=(244, 232, 176, 255), font=font)
        draw.text((14, y + 34), f'{row["size"][0]}x{row["size"][1]} px', fill=(164, 181, 186, 255), font=font)
        draw.text((14, y + 50), spec_line.encode("ascii", "replace").decode("ascii"), fill=(120, 145, 154, 255), font=font)
        if row["notes"]:
            draw.text((14, y + 68), "note: " + row["notes"][0][:22], fill=(255, 175, 96, 255), font=font)
        sheet.alpha_composite(card(row["source_img"], "source"), (left_w, y))
        sheet.alpha_composite(card(row["polished_img"], "polished"), (left_w + col_w, y))
        sheet.alpha_composite(card(row["template_img"], "template"), (left_w + col_w * 2, y))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGBA").save(out_path)


def write_readme(out_dir: Path, rows: list[dict]) -> None:
    ids = ", ".join(row["id"] for row in rows)
    text = f"""# Prop Sprite Review Kit

Review-only output generated by `scripts/prop_sprite_review.py`.

The polished PNGs are based on the current originals in `frontend/assets/furniture`.
Each polished sample keeps the original canvas size and alpha mask exactly, so it
cannot spill outside the current sprite silhouette. The template PNGs show:

- green lines: 48 px source-pixel grid, corresponding to the 12 px runtime tile grid at 4x
- yellow rectangle: current `PropSprites.CATALOG` footprint, clipped to the source canvas
- blue rectangle: non-transparent source bounds
- white edge: source alpha outline

Samples generated: {ids}

Review files:

- `review-sheet.png` - side-by-side source, polished sample, and template
- `variants/*-polished.png` - candidate art only, not wired into runtime
- `templates/*-template.png` - grid and mask guides
- `manifest.json` - dimension, alpha, and catalog-footprint validation

To regenerate:

```powershell
python scripts/prop_sprite_review.py
```
"""
    with (out_dir / "README.md").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="review output directory")
    parser.add_argument("--samples", nargs="*", default=SAMPLES, help="prop ids to process")
    args = parser.parse_args()

    catalog = load_catalog()
    out_dir = Path(args.out)
    variants = out_dir / "variants"
    templates = out_dir / "templates"
    variants.mkdir(parents=True, exist_ok=True)
    templates.mkdir(parents=True, exist_ok=True)

    manifest = {
        "kind": "review-only-prop-sprite-template",
        "sourceDir": str(SOURCE_DIR.relative_to(ROOT)).replace("\\", "/"),
        "pixelsPerTile": PIXELS_PER_TILE,
        "alphaInvariant": True,
        "samples": [],
    }
    rows = []

    for prop_id in args.samples:
        src_path = SOURCE_DIR / f"{prop_id}.png"
        if not src_path.exists():
            raise FileNotFoundError(src_path)
        src = Image.open(src_path).convert("RGBA")
        bbox = src.getchannel("A").getbbox()
        polished = edge_and_contrast(src)
        if bbox:
            apply_detail_pass(polished, prop_id, bbox)
        polished.putalpha(src.getchannel("A"))
        tpl = make_template(src, catalog.get(prop_id), bbox)

        polished_path = variants / f"{prop_id}-polished.png"
        template_path = templates / f"{prop_id}-template.png"
        polished.save(polished_path)
        tpl.save(template_path)

        spec = catalog.get(prop_id)
        notes = []
        if spec:
            expected_w = spec["w"] * PIXELS_PER_TILE
            expected_h = spec["h"] * PIXELS_PER_TILE
            if src.width != expected_w:
                notes.append(f"canvas width {src.width}px differs from catalog footprint width {expected_w}px")
            if src.height < expected_h:
                notes.append(f"canvas height {src.height}px is smaller than catalog footprint height {expected_h}px")

        entry = {
            "id": prop_id,
            "source": str(src_path.relative_to(ROOT)).replace("\\", "/"),
            "polished": str(polished_path.relative_to(ROOT)).replace("\\", "/"),
            "template": str(template_path.relative_to(ROOT)).replace("\\", "/"),
            "size": {"width": src.width, "height": src.height},
            "alphaBounds": list(bbox) if bbox else None,
            "alphaPixels": sum(1 for a in src.getchannel("A").tobytes() if a),
            "sourceAlphaHash": alpha_hash(src),
            "polishedAlphaHash": alpha_hash(polished),
            "alphaIdentical": alpha_hash(src) == alpha_hash(polished),
            "sourceHash": color_hash(src),
            "polishedHash": color_hash(polished),
            "catalog": spec,
            "notes": notes,
        }
        manifest["samples"].append(entry)
        rows.append({
            "id": prop_id,
            "size": (src.width, src.height),
            "spec": spec,
            "notes": notes,
            "source_img": src,
            "polished_img": polished,
            "template_img": tpl,
        })

    with (out_dir / "manifest.json").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n")
    make_review_sheet(rows, out_dir / "review-sheet.png")
    write_readme(out_dir, rows)
    print(f"Wrote {len(rows)} prop samples to {out_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
