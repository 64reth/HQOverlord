---
name: UI Sketch
slug: ui-sketch
description: Explore a design direction as 2-3 disposable HTML mockups to compare side by side before committing to one.
category: Creative
requires: [cabinet]
license: MIT
default: false
---

Use this when the Commander wants to *see* a design direction before committing — exploring a screen as disposable HTML mockups. The point is 2-3 interactive variants to compare, not shippable code.

Triggers: "sketch this screen", "show me what X could look like", "compare layout A vs B", "give me a couple takes on this UI", "mockup this before I build".

## When NOT to sketch
- They want a production component — build it properly.
- They want a diagram — use Excalidraw or Concept Diagrams.
- The design is already locked — just build it.

## Method
```
intake → variants → head-to-head → pick winner (or iterate)
```

### 1. Intake (skip if they gave enough)
One question at a time, not all at once: what screen/flow, who's the user, what's the single most important action on it.

### 2. Variants (2-3, genuinely different)
Each is ONE self-contained HTML file with inline CSS — no build, no external assets. Make the variants *different strategies*, not recolors: e.g. dense-dashboard vs. focused-single-task vs. wizard-steps. Use realistic placeholder content, not lorem ipsum. Keep them fast to skim.

### 3. Head-to-head
fs.write each as `sketch-<name>-a.html` / `-b.html` / `-c.html`. Present a one-line pitch per variant: what it optimizes for and its tradeoff. Ask the Commander to open all and say which direction feels right.

### 4. Pick / iterate
Once they pick, either iterate that one variant further or hand off the direction to a real build. Delete the losers — sketches are disposable.

*Needs the CABINET (write files) object to save the mockups.*
