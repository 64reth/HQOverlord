---
name: Voice Match
slug: voice-match
description: Study what the Commander actually wrote, name their voice explicitly, then draft in it — including the words they never use.
category: Writing
requires: [cabinet, notebook]
license: MIT
default: false
---

A voice is not a vibe. It is a set of observable habits, and it can only be copied from real samples — never from a description of how someone thinks they write.

## Method
1. **Get real samples.** Read three or more things the Commander actually wrote with fs.read. Their own messages, notes, posts, replies. A described voice ("casual but professional") is worthless; a sample is evidence.
2. **Name the voice out loud, in traits you can check:** average sentence length and whether it varies; contractions or not; vocabulary register; how they open; how they close; punctuation habits (dashes, ellipses, sentence fragments, exclamation use); paragraph length.
3. **Catalogue the ANTI-patterns.** The words, phrases, and constructions they never use. Avoiding these does more for a voice than copying favourites — most drafts are caught by what a person would never say, not by what they would.
4. **Say the profile back** before drafting, so the Commander can correct it. A wrong voice profile silently ruins every later draft.
5. **Set the register for the audience.** The same person writes differently to a friend and to a client — same voice, different volume. Ask which, or infer it from the sample closest to that audience.
6. **Draft, then diff.** Read your draft against the samples and fix the places where you drifted back to neutral assistant prose.
7. **Persist the profile** with notebook.write so later drafts start from it instead of relearning.

## Rules
- **Keep the rough edges.** Fragments, quirky punctuation, and odd word choices are the voice. Smoothing them out is the failure mode.
- **Never invent a fact to fit the voice.** Style is copied; substance comes from the Commander.
- Flag any place you were unsure of the voice rather than guessing confidently.

## Output
The draft first, then the voice traits you matched, then the specific lines you were unsure about.

*Needs the CABINET (their real writing) and the NOTEBOOK (the saved voice profile) objects.*
