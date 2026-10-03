---
name: ASCII Art
slug: ascii-art
description: Make text banners and ASCII art — generated directly, or with figlet/cowsay when a terminal is placed.
category: Creative
requires: []
license: MIT
default: true
---

Produce ASCII art: big text banners, speech-bubble art, and small pictures. The baseline needs no tools — you can render clean ASCII directly. If a WORKBENCH (terminal) is on the floor, prefer the dedicated tools for crisp, consistent fonts.

## Without a terminal (always works)
Generate the art yourself. For a banner, draw the letters in a block or slant style with consistent height and even spacing; keep every line aligned. For small pictures, use a tight character ramp (e.g. ` .:-=+*#%@`) and keep it small. Offer 2–3 styles and let the Commander pick.

## With a WORKBENCH (sharper output)
- **Banners — pyfiglet (571 fonts):**
  - `pip install pyfiglet --break-system-packages -q`
  - `python3 -m pyfiglet "YOUR TEXT" -f slant` — good fonts: `slant`, `doom`, `big`, `small`, `banner3`, `cyberlarge`, `3-d`
- **No-install banner via a free API:** `curl -s "https://asciified.thelicato.io/api/v2/ascii?text=Hello+World&font=Slant"` (URL-encode spaces as `+`; the response is plain ASCII, ready to show).
- **Speech bubbles — cowsay:** wraps a message in a bubble with a character.

## Tips
- Short text (1–8 chars) suits detailed fonts (`doom`, `block`); long text suits compact fonts (`small`, `mini`).
- Banners read best in a monospace context. With a CABINET (write files) you can drop the result into a `.txt`.

*The figlet/cowsay/curl tools require the WORKBENCH object; without it, the art is generated directly.*
