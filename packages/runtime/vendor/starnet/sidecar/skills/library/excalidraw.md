---
name: Excalidraw Diagrams
slug: excalidraw
description: Write hand-drawn-style .excalidraw JSON diagrams (architecture, flow, sequence) that open at excalidraw.com — no libraries.
category: Creative
requires: [cabinet]
license: MIT
default: false
---

Create diagrams as standard Excalidraw element JSON saved to a `.excalidraw` file. The Commander drags it onto [excalidraw.com](https://excalidraw.com) to view and edit — no accounts, no API keys, no rendering libraries, just JSON written with fs.write.

Good for architecture diagrams, flowcharts, sequence diagrams, and concept maps where a hand-drawn look is wanted.

## Envelope
Wrap your elements in this and save with fs.write to `<name>.excalidraw`:
```json
{ "type": "excalidraw", "version": 2, "source": "starnet",
  "elements": [ /* your elements */ ],
  "appState": { "viewBackgroundColor": "#ffffff" } }
```

## Element shapes
Each element is an object. Common fields: `id` (unique string), `x`, `y`, `width`, `height`, `angle:0`, `strokeColor`, `backgroundColor`, `fillStyle:"hachure"`, `strokeWidth:1`, `roughness:1`, `seed` (any int), `version:1`.

- **Rectangle:** `"type":"rectangle"` + the box fields. Use `"roundness":{"type":3}` for rounded corners.
- **Text:** `"type":"text"`, `"text":"Label"`, `"fontSize":20`, `"fontFamily":1` (hand-drawn), plus `x`/`y`. Set `width`/`height` roughly to the text extent.
- **Arrow/line:** `"type":"arrow"`, `"points":[[0,0],[dx,dy]]` (relative to the element's x/y), and bind ends with `"startBinding":{"elementId":"..."}` / `"endBinding":{...}` to snap them to shapes.

## Method
1. Sketch the layout on a grid mentally: boxes on a coarse grid (say 200px apart), arrows between their edges.
2. Give every element a unique `id` and a random `seed` — reused seeds make the hand-drawn wobble identical and look mechanical.
3. Bind arrows to the boxes they connect so the diagram stays coherent when the Commander drags things.
4. fs.write the file, then tell them to open excalidraw.com and drop it in.

*Needs the CABINET (write files) object to save the .excalidraw file.*
