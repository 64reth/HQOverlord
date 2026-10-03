---
name: Humanizer
slug: humanizer
description: Strip AI-isms from writing and give it a real human voice.
category: Writing
requires: []
license: MIT
default: true
---

Identify and remove the signs of AI-generated text so writing sounds natural and human.

**Key insight:** LLMs guess the most statistically likely next words, which is how the telltale patterns below get baked in. Removing them is only half the job — voiceless writing is just as obviously AI. Add a real human behind the words.

## When to use
The Commander asks you to "humanize", "de-AI", or "de-slop" text; to rewrite a draft (post, essay, PR, docs, email, tweet) so it doesn't read like an LLM; or to match their voice. **Also apply it to your own user-facing prose** before you ship it.

## The patterns to strip
1. **Significance inflation** — "stands as a testament", "pivotal moment", "evolving landscape", "vital role", "marking a shift". Cut it; state the plain fact.
2. **Notability puffing** — listing media/credentials to prove importance. Replace with one specific, sourced claim.
3. **Superficial -ing tails** — "…, highlighting/underscoring/reflecting/ensuring X". Delete the participle phrase.
4. **Promotional language** — "nestled in the heart of", "vibrant", "breathtaking", "rich cultural heritage", "must-visit". Neutral tone.
5. **Vague attribution / weasel words** — "Experts argue", "Industry reports", "Observers note". Name a real source or cut.
6. **Formulaic "Challenges and Future Prospects"** sections. Replace with concrete specifics.
7. **AI vocabulary** — delve, crucial, intricate, tapestry, underscore, leverage, foster, garner, seamless, landscape, testament, pivotal, vibrant. These co-occur; hunt them.
8. **Copula avoidance** — "serves as / functions as / boasts" → just use *is / are / has*.
9. **Negative parallelism** — "It's not just X, it's Y" and tailing negations ("…, no guessing"). Write the real clause.
10. **Rule of three** — forced triples ("innovation, inspiration, and insight"). Break the pattern.
11. **Synonym cycling** — protagonist/main character/central figure/hero for the same noun. Pick one.
12. **False ranges** — "from the Big Bang to dark matter" where X and Y aren't a real scale.
13. **Passive / subjectless fragments** — "No config needed", "results are preserved automatically" → name the actor.
14. **Em-dash overuse** — most become commas, periods, or parentheses.
15. **Boldface spam** and **16. inline-header bullet lists** (`**Thing:** sentence`). Write prose.
17. **Title Case Headings** → sentence case. **18. Emojis** in headings/bullets → remove.
19. **Curly quotes** → straight quotes.
20. **Chatbot artifacts** — "Great question!", "Certainly!", "I hope this helps!", "Let me know…". Delete.
21. **Knowledge-cutoff disclaimers** — "As of my last update…", "While details are limited…". Delete.
22. **Sycophancy** — "You're absolutely right!", "Excellent point!". Delete.
23. **Filler** — "in order to"→"to", "due to the fact that"→"because", "at this point in time"→"now".
24. **Over-hedging** — "could potentially possibly" → "may".
25. **Generic upbeat conclusions** — "the future looks bright, exciting times ahead". Replace with a concrete next step.
26. **Uniformly hyphenated pairs** — humans don't hyphenate "high-quality, data-driven, client-facing" with perfect consistency.
27. **Persuasive-authority tropes** — "The real question is", "at its core", "what really matters".
28. **Signposting** — "Let's dive in", "here's what you need to know". Just say the thing.
29. **Fragmented headers** — a heading followed by a one-line restatement of itself.

## Add a voice (don't leave it sterile)
Have opinions and react to facts. Vary rhythm — short punchy sentences, then a longer one. Acknowledge complexity and mixed feelings. Use "I" when it fits. Let a little mess in (asides, half-thoughts). Be specific about feelings ("there's something unsettling about agents working at 3am while nobody watches", not "this is concerning").

If the Commander gives a writing **sample**, read it first and match its sentence length, word level, punctuation habits, and transitions before rewriting.

## Process
1. Read the text (use `fs.read` if it's a file).
2. Find every pattern above; rewrite each problem section; preserve meaning and tone.
3. Produce a draft. Then ask yourself: **"What makes this obviously AI-generated?"** — answer in brief bullets.
4. Revise once more against those tells. Present the final version.
5. If it came from a file, apply the edit with `fs.edit` (targeted) or `fs.write`, and show what changed — never silently overwrite.

*Condensed for in-prompt use; the 29 patterns are preserved.*
