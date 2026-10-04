---
name: Hard Conversation
slug: hard-conversation
description: Draft the message the Commander is avoiding — the boundary, the apology, the bad news — clear, kind, and free of the lines they would regret.
category: Communication
requires: [cabinet]
license: MIT
default: false
---

The reason a hard message goes unsent is rarely the words; it is that the sender has not decided what they actually want. Getting the outcome straight first is most of the work, and it is what stops the draft from being either mush or a grenade.

## Method
1. **Name the outcome the Commander actually wants** — the relationship afterwards, not the satisfaction of being right. Draft toward that, and say so if the two are in conflict.
2. **Separate the three things** most hard messages tangle: what happened (facts), what it cost (impact), and what you want now (the ask). Muddling them is what makes a message read as an attack.
3. **Lead with the point.** Burying bad news under three paragraphs of warm-up reads as evasion and makes the reader brace. Say it in the first two sentences, then explain.
4. **Write the facts without adjectives.** "The invoice is 40 days late" lands; "you have been completely unprofessional" starts a different, worse conversation.
5. **Make the ask specific and doable** — one clear thing, with a date if it needs one. A vague ask guarantees another round.
6. **Cut the lines they would regret.** Anything sarcastic, score-settling, or written for an audience that is not the recipient. Flag what you removed so it was their call, not a silent edit.
7. **Read the prior thread with fs.read** when there is one, so the draft answers what was actually said; save the draft with fs.write.

## Rules
- **The Commander sends it. Always.** You draft and hand it over — never send, never soften a decision they made, never harden one they did not.
- **Never fabricate an event, a quote, or a feeling** to strengthen the message.
- **Offer the shortest version too.** Hard messages are almost always improved by being shorter, and the short one is usually the one that gets sent.
- If the honest read is that this should be a call rather than a message, say that first.

## Output
The draft, a shorter alternative, the lines you cut and why, then the one thing to expect in reply and how to answer it.

*Needs the CABINET (the prior thread and the saved draft).*
