---
name: Popular Web Designs
slug: popular-web-designs
description: Style a page after a known brand's visual language (Stripe, Linear, Vercel, Notion...) with concrete color, type, and spacing values.
category: Creative
requires: [cabinet]
license: MIT
default: false
---

When the Commander wants a page that *looks like* a well-known product — "make it look like Stripe", "design like Linear", "Vercel style" — reach for that brand's real visual vocabulary instead of generic defaults. Deliver a self-contained HTML/CSS file written with fs.write.

## How to use
1. Pick the target design language and pin down its concrete tokens (below).
2. Write ONE self-contained HTML file: inline CSS, system or Google-font stack, realistic content (not lorem ipsum).
3. fs.write it, tell the Commander to open it and resize to check responsiveness.

## Reference vocabularies (concrete tokens)
- **Stripe** — off-white `#ffffff`/`#f6f9fc` sections, indigo accent `#635bff`, angled section dividers, soft layered shadows (`0 2px 5px rgba(0,0,0,.04)`), Söhne/Inter-like sans, generous line-height, subtle gradient hero.
- **Linear** — near-black `#08090a` bg, high-contrast white text, thin `1px` `#ffffff14` borders, tight radii (`8px`), Inter, restrained purple accent `#5e6ad2`, crisp small type, minimal shadow.
- **Vercel** — pure black/white, geometric sans (Geist/Inter), stark contrast, monospace code accents, thin dividers, lots of negative space, no color unless functional.
- **Notion** — warm white `#ffffff`, ink `#37352f`, generous margins, serif-ish display headings + clean body sans, soft gray hovers `#00000008`, block-based layout, minimal borders.

For any brand not listed, derive its tokens from what you know of the site: primary bg, text ink, one accent, border treatment, radius scale, font family, and shadow depth — then apply them consistently.

## Rules
- Match the *system* (color temperature, radius scale, shadow depth, type hierarchy), not one screenshot.
- Consistency beats feature count — one shadow recipe, one radius scale, one accent used sparingly.
- Pair with the UI Sketch skill when they want multiple directions to compare.

*Needs the CABINET (write files) object.*
