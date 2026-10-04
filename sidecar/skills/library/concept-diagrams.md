---
name: Concept Diagrams
slug: concept-diagrams
description: Flat, minimal, light/dark-aware SVG diagrams for education and physical subjects — saved as a standalone HTML file.
category: Creative
requires: [cabinet]
license: MIT
default: false
---

Generate a clean, flat, educational SVG diagram as a single self-contained HTML file (inline SVG, no libraries, no keys). The Commander opens it in any browser, offline. Write it with fs.write.

## Best for
Physics setups, chemistry mechanisms, math curves, biology, physical objects (aircraft, turbines, watches, cells), anatomy, cross-sections, exploded views, floor plans, narrative journeys (lifecycle of X), hub-and-spoke systems. It's also a fine general-purpose SVG fallback. For dark tech/cloud architecture prefer the Architecture Diagram skill; for hand-drawn use Excalidraw.

## Design system (the look)
- **Flat and minimal.** No gradients, no drop shadows, no skeuomorphism. Solid fills, thin 1.5-2px strokes, generous whitespace.
- **Semantic color ramps.** Assign a consistent hue per concept category and use only its light/mid/dark steps; don't rainbow every element. Keep to ~4-5 hues total.
- **Typography:** a system sans; sentence case, never all-caps. ~14px labels, ~11px annotations.
- **Light/dark aware.** Drive every color from CSS custom properties in a `:root` block plus a `@media (prefers-color-scheme: dark)` override, so the same file reads well in both themes. Never hardcode `#fff`/`#000` in the SVG.

## Layout rules
- One clear reading order (left-to-right or top-to-bottom). Align elements to an invisible grid.
- Label directly next to what it names; use thin leader lines only when a label can't sit adjacent.
- Arrows/flows are thin with small markers; keep them behind the shapes they connect.
- Leave a margin; a legend (if any) sits outside the diagram body, below everything.

## Flow
Ask for the subject and its parts/relationships → lay it out on the grid → write the full HTML (`:root` vars + `@media` dark override + inline `<svg>`) → fs.write to `<subject>-diagram.html` → tell the Commander to open it.

*Needs the CABINET (write files) object.*
