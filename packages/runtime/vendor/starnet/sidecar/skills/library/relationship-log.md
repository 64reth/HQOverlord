---
name: Relationship Log
slug: relationship-log
description: Keep a durable record of the people the Commander deals with — what matters to them, what was promised, and what is owed next.
category: Productivity
requires: [notebook, cabinet]
license: MIT
default: false
---

Relationships fail on forgotten specifics: the promise you made, the thing they mentioned, the follow-up that never came. This is bookkeeping for people, and its whole value is that it persists between conversations.

## Method
1. **One record per person**, written to notebook.write so it survives the session: who they are, how the Commander knows them, and the context they met in.
2. **Capture what the person actually said matters to them** — the project they are stuck on, the trip they are taking, the thing they are proud of. Their words, not a summary of their vibe.
3. **Log commitments in both directions, explicitly.** What the Commander promised and by when; what the other person owes back. An unlogged promise is the one that gets broken.
4. **Record the last real contact and its substance**, so the next message can open where the last one closed instead of restarting.
5. **Surface what is due.** On each pass, name who is owed something, who has gone quiet longer than the relationship warrants, and what the natural next touch actually is.
6. **Keep long-form notes and documents in files with fs.write**; keep the durable, queryable facts in the notebook.

## Rules
- **Never invent a detail about a person.** If it was not said, it is not in the record. A fabricated preference is worse than an empty field.
- **Record facts and commitments, not judgements of character.** This log may be read back aloud one day.
- **Never suggest manipulating anyone** — the point is remembering what you owe people, not leverage over them.
- Keep it proportionate: a colleague does not need a dossier. Log what genuinely helps you treat them well.
- The Commander sends every message; you draft and remind, never reach out on their behalf.

## Output
The updated person records, then what is due now — who is owed a reply, a promise coming up, and who has gone quiet — each with the specific next touch.

*Needs the NOTEBOOK (durable memory) and the CABINET (long-form notes) objects.*
