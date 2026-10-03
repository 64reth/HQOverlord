---
name: Architecture Diagram
slug: architecture-diagram
description: Dark-themed SVG architecture / cloud / infra diagrams saved as a standalone HTML file.
category: Creative
requires: [cabinet]
license: MIT
default: false
---

Generate a professional, dark-themed technical architecture diagram as a standalone HTML file with inline SVG — no libraries, no API keys. Write the `.html` with fs.write; the Commander opens it in any browser, offline.

## Best for
Software system layers (frontend / backend / database), cloud infra (VPC, regions, subnets, managed services), microservice topology, deployment maps. Not for science, physical objects, floor plans, or hand-drawn sketches.

## Design system (the look)
- **Background:** slate-950 `#020617` with a subtle 40px grid (a `<pattern>` of thin `#1e293b` lines).
- **Font:** JetBrains Mono from Google Fonts. Sizes: 12px names, 9px sublabels, 8px annotations.
- **Components:** rounded rects (`rx="6"`), 1.5px stroke. Semantic colors (fill rgba / stroke hex):
  - Frontend `rgba(8,51,68,.4)` / `#22d3ee` · Backend `rgba(6,78,59,.4)` / `#34d399`
  - Database `rgba(76,29,149,.4)` / `#a78bfa` · Cloud `rgba(120,53,15,.3)` / `#fbbf24`
  - Security `rgba(136,19,55,.4)` / `#fb7185` · Message bus `rgba(251,146,60,.3)` / `#fb923c` · External `rgba(30,41,59,.5)` / `#94a3b8`
- **Masking:** to stop arrows showing through translucent fills, draw an opaque `#0f172a` rect first, then the styled rect on top.

## Layout rules
- Draw arrows EARLY (right after the grid) so they sit behind the boxes. Arrowheads via SVG markers; security flows are dashed rose.
- Service height ~60px (80–120px for large blocks). Minimum 40px vertical gap. Put message buses IN the gap between services, never overlapping them.
- Boundaries: security groups dashed `4,4` rose; regions dashed `8,4` amber, `rx="12"`.
- **Legend goes OUTSIDE all boundary boxes** — compute the lowest boundary Y and place it ≥20px below.

## Flow
Ask for components + connections → build the HTML → `fs.write` to `<project>-architecture.html` → tell the Commander to open it.

*Needs the CABINET (write files) object.*
