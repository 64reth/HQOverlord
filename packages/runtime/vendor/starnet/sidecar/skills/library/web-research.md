---
name: Web Research
slug: web-research
description: Research a question across multiple sources, cross-check claims, and save a cited brief.
category: Research
requires: [dish, cabinet]
license: MIT
default: false
---

Answer a research question properly: gather from several independent sources, cross-check, and write a brief that cites where each claim came from. Never invent facts or links.

## Method
1. **Frame it.** Restate the question and what a good answer must cover. If it's broad, break it into 3–5 sub-questions.
2. **Search wide (web_search).** For each sub-question run a few queries from different angles. Collect candidate sources; prefer primary, official, or recent ones over aggregators.
3. **Read, don't skim (web_fetch).** Open the actual pages. Pull the specific facts, numbers, and quotes — with the source URL beside each.
4. **Cross-check.** A claim that matters should appear in two independent sources. Flag conflicts and date-sensitive facts explicitly. Note what you could NOT confirm.
5. **Synthesize.** Write the brief: the answer up front, then the supporting points, each with a citation. Distinguish established fact from your own inference.

## Rules
- **Ground every factual claim in a fetched source and cite the URL.** No source → label it "unverified", don't assert it.
- **Recency matters** — note when a fact is as-of a date, and prefer current sources for moving targets.
- **Save the deliverable.** Write the brief to a file with fs.write (e.g. `research-<topic>.md`) so the Commander keeps it.

## Output
A cited brief: a 2–3 sentence answer, then bullet points each ending with their source link, then a short "what I couldn't confirm" list.

*Needs the DISH (web) + CABINET (files) objects.*
