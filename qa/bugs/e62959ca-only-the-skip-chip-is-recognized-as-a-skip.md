---
fingerprint: e62959ca
slug: only-the-skip-chip-is-recognized-as-a-skip
title: Only the skip CHIP is recognized as a skip — the typed word the interview invites ("skip") is stored as a weight:'stated' belief, raising FAMILIARITY, opening t
surface: onboarding
severity: P0
status: fixed
found: 2026-07-28
lane: sweep/onboarding
fix: 6afeb9ee
---

# Only the skip CHIP is recognized as a skip — the typed word the interview invites ("skip") is stored as a weight:'stated' belief, raising FAMILIARITY, opening t

## Symptom

The intake interview's composer placeholder literally reads `tell the station about yourself… (or "skip")` and its opening line says `answer or tap, "skip" anything`. A user who follows that instruction and types `skip` has the string "skip" written into the Commander Dossier as a weight:'stated' belief for that dimension. The COMMANDER panel then counts the dimension as KNOWN (the FAMILIARITY gauge rises), CuriosityStore.markAnswered() clears its ask tally, the dimension is no longer blank so Interview.plan()/Curiosity.pick() never ask it again, and the belief is injected verbatim into every agent's briefing. Three typed "skip"s flip the shared recommendation gate to ready:true with zero real knowledge.

## Repro

Fresh station (node dev/onboard-fresh.js). Complete the awakening, then open COMMANDER DOSSIER and press ▸ LET THE STATION GET TO KNOW YOU (or accept a post-run curiosity nudge). The COMMS placeholder reads `tell the station about yourself… (or "skip")`. Type `skip` and press Enter instead of tapping the skip chip. Reopen the COMMANDER panel: that dimension now shows a belief card reading "skip", the FAMILIARITY percentage has risen, and the AGENT BRIEFING block contains it. Repeat for identity/goals/pain and UnderstandingStore.readiness() returns ready:true. Headless proof: `node -e "const I=require('./frontend/app/interview.js'),U=require('./frontend/app/understanding.js');console.log(I.beliefFromAnswer(I.questionFor('identity'),'skip'));const m=t=>({text:t,source:'interview',weight:'stated'});console.log(U.readiness({dims:{identity:[m('skip')],goals:[m('skip')],pain:[m('skip')]}}))"`

## Evidence

`frontend/app/intake.js:81`

**Mechanism (read from the code):** intake.js:36 wires `Chat.beginInterview(text => answer(text, text, false), { placeholder: 'tell the station about yourself… (or "skip")' … })` — the typed path always passes explicitSkip=false. intake.js:81 is then the only skip test: `const isSkip = explicitSkip || text === '';`. Only the empty string counts. So `Interview.beliefFromAnswer(q, 'skip')` runs, and interview.js:134-140 has no skip vocabulary either — `const t = String(text).trim(); if (!t) return null;` then returns `{dim, text:t, source:'interview', weight:'stated'}`. dossier.js upsert() (line 89-112) only rejects empty text. The skip CHIP works because it carries `value: ''` (interview.js:33) — chip and typed word diverge on the same instruction. I ran it: `beliefFromAnswer(questionFor('identity'), 'skip')` -> `{"dim":"identity","text":"skip","source":"interview","weight":"stated"}`, and `Understanding.readiness({dims:{identity:[skip],goals:[skip],pain:[skip]}})` -> `{"ready":true,"reasons":[],"familiarity":0.333}`. understanding.js:147-198 is the single shared gate for "pitch / suggest / scout-mint / quest-refresh / starter-chip" — every proactive (and paid) surface turns on. Same shape for 'no', 'n/a', 'pass'.

**Existing test coverage:** test/interview.test.js:53-56 — it covers `'   '`, `''` and `null` (all the CHIP path) and asserts `beliefFromAnswer(q0, cannedVal).weight === 'seed'`, but never the literal word "skip" the UI copy invites. It passes vacuously: the empty-string case is the only skip the code knows, and the test only exercises that.

**Adversarial verdict (survived refutation):** Read every hop and it holds. frontend/app/intake.js:36 wires the typed path as `text => answer(text, text, false)` — explicitSkip is hardcoded false — and intake.js:81 `const isSkip = explicitSkip || text === '';` is the only skip test, so the literal word never counts. frontend/app/chat.js:5709 (`if (interview) { clearChoices(); interview(text); return; }`) hands the raw typed string straight through with zero normalization; I grepped all of frontend/app for any skip-vocabulary test and there is none. frontend/app/interview.js:134-140 returns `{dim, text:'skip', source:'interview', weight:'stated'}` because 'skip' matches no chip `value` (the skip chip's value is '' — interview.js:33), and frontend/app/dossier.js:89-97 only rejects empty text. Ran the proof headless: beliefFromAnswer(questionFor('identity'),'skip') -> weight 'stated'; Understanding.readiness with three such beliefs -> {"ready":true,"reasons":[],"familiarity":0.333}. Both launch sites pass the weight through unchanged (frontend/app/stationui.js:5327 and frontend/app/chat.js:3763/3786), so it reaches DossierStore and therefore dossier.js:167 composeBlock (verbatim into every agent's system prompt) and dossier.js:194 summary (FAMILIARITY). This breaks the law written directly above the gate — understanding.js:150-151 'it never fabricates readiness a blitzed onboarding didn't earn' — and dossier.js:53-57 'the blitz-through-onboarding poison this field exists to kill'. test/interview.test.js exercises only the empty/blank chip path (lines 25, 53-56), never the typed word, so it passes vacuously against this. The COMMS placeholder at intake.js:36 and the opening line at intake.js:42 both invite the exact word the code cannot recognize.

_Found by the `sweep/onboarding` lane, 2026-07-28. Finder confidence: high. Severity claimed P0, after refutation P0._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
