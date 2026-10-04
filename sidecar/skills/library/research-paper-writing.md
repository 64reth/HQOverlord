---
name: Research Paper Writing
slug: research-paper-writing
description: End-to-end ML/AI paper pipeline — literature review, experiment design, analysis, drafting, and revision as an iterative loop.
category: Research
requires: [workbench, dish]
license: MIT
default: false
---

Produce a publication-ready ML/AI research paper (NeurIPS/ICML/ICLR/ACL style). This is **not linear** — it's a loop: results trigger new experiments, reviews trigger new analysis. Handle the feedback.

## Phases
0. **Setup.** Restate the claim the paper will make in one sentence. Create the workspace (paper draft, `experiments/`, `results/`). If there's no crisp claim yet, that's the first thing to find.
1. **Literature review.** Use web_search + the arXiv API to find the 10-20 most relevant papers. Read abstracts (web_fetch), extract each paper's claim, method, and gap. Position your contribution against them — what's genuinely new.
2. **Experiment design.** State each hypothesis as a testable prediction with a metric and a baseline. Design the minimal experiment that could *falsify* it. Fix seeds; log configs.
3. **Execution.** Run experiments with `shell.exec` / `verify.run`. Monitor long runs; checkpoint. Save raw results to `results/` — never overwrite.
4. **Analysis.** Compute the metrics AND their variance/significance (report confidence intervals, not point estimates). A result without error bars is not a result. Make the figures reproducible from a script.
5. **Drafting.** Standard structure: abstract, intro (claim + contributions as a bullet list), related work, method, experiments, results, limitations, conclusion. Every quantitative claim in the text must trace to a number in a table/figure.
6. **Review + revision.** Re-read as a hostile reviewer: is the claim supported by the evidence? Are baselines fair? What's the obvious rebuttal? Fix the weakest link, re-run if needed, loop.

## Rules
- **No claim beyond the evidence.** If the data shows X on one dataset, don't write "X in general".
- **Report negative results honestly** — they belong in limitations, not the trash.
- **Reproducibility:** every number regenerates from a committed script + fixed seed.

*Needs WORKBENCH (run experiments) + DISH (literature search).*
