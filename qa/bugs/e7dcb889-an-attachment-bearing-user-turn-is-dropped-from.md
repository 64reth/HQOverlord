---
fingerprint: e7dcb889
slug: an-attachment-bearing-user-turn-is-dropped-from
title: An attachment-bearing user turn is dropped from the durable transcript and the PREVIOUS turn is written in its place — the string-only scan at index.js:11299 fa
surface: sessions
severity: P0
status: fixed
found: 2026-07-28
lane: sweep/sessions
fix: 6afeb9ee
---

# An attachment-bearing user turn is dropped from the durable transcript and the PREVIOUS turn is written in its place — the string-only scan at index.js:11299 fa

## Symptom

Send a photo/file with a question. The durable transcript for that workstream never contains the question — instead the Commander's PREVIOUS message is written to disk a second time, as if they had said it twice. The run-history row for that run is titled with the previous message too. After a cache wipe / new browser, the resume seed replays that fabricated history back to the model, and recall_conversation / GET /api/transcript both report a conversation that never happened.

## Repro

Boot the sidecar against a temp WORKSPACES with a mock provider. Run 1 on stream 'probe-stream': messages [user 'FIRST TURN about kittens']. POST /api/attachments a 1x1 png. Run 2 on the SAME stream: messages [user 'FIRST TURN about kittens', assistant 'ok.', user 'SECOND TURN what colour is this pixel?' + attachments:[ref]]. Then GET /api/transcript?agent=e2e&stream=probe-stream and GET /api/runs?agent=e2e. Observed live: transcript = user 'FIRST TURN about kittens' / assistant 'ok.' / user 'FIRST TURN about kittens' / assistant 'ok.' — 'SECOND TURN' appears nowhere; both run rows are titled "FIRST TURN about kittens".

## Evidence

`sidecar/index.js:11299`

**Mechanism (read from the code):** `attachments.expandUserAttachments()` (called at index.js:9813) REPLACES the attachment-bearing user message's `content` with an ARRAY of provider blocks (`attachments.js:140`: `Object.assign({}, m, { content: blocks.length ? blocks : '' })`). Every consumer at the run-end seam then scans for the latest user turn with a STRING guard: index.js:11299 `if (msgs[i] && msgs[i].role === 'user' && typeof msgs[i].content === 'string') { title = msgs[i].content; break; }`. The array-content turn fails that test, so the scan walks PAST it and lands on an earlier, already-persisted user line. That value is then used twice: `runStore.record({ ... title: title ... })` (11300) and `if (title) transcriptStore.append({ streamId: o.streamId, agentId, role: 'user', content: title })` (11305). The real directive can't recover on the next line either — `transcriptStore.markPersisted(msgs)` (11175) marked the expanded clone, so `appendNew` (11306) skips it by design. Same string-only shape at index.js:10032 (taskBrief.text — the Task Brief card shows the wrong ask), 11137 (memory-recall query collapses to '') and 11405 (studyDirective). The identical line also duplicates the directive on a plain RETRY after an errored run: chat.js:5734 skips re-pushing the user turn on retry, so the retried POST's last user message is one this line already appended, and it is appended again.

**Existing test coverage:** test/e2e.attachments.test.js — drives EXACTLY this path (POST /api/run with an attachment on the user turn) but asserts only that the base64 bytes reach the mocked provider; it never reads /api/transcript or /api/runs. test/e2e.run.test.js:145 does assert 'transcript captured the user directive', but only for a plain string-content turn, so it passes vacuously here. No test found that sends an attachment and then inspects the transcript or the run title.

**Adversarial verdict (survived refutation):** Read + reproduced live. sidecar/attachments.js:140 replaces the attachment-bearing user message's content with a BLOCKS ARRAY (`Object.assign({}, m, { content: blocks.length ? blocks : '' })`), and index.js:9813 feeds that expanded array into runOnce as `messages`, which becomes `msgs` at index.js:11125. The run-end scan at index.js:11299 is string-only (`typeof msgs[i].content === 'string'`), so it walks PAST the attachment turn onto an earlier, already-persisted user line; that value is used both as `runStore.record({... title })` (11300) and `transcriptStore.append({ role:'user', content: title })` (11305). The real turn cannot recover via appendNew (11306): transcriptStore.markPersisted(msgs) at 11173 stamped the expanded object with the PERSISTED symbol and appendNew skips it (transcriptstore.js:239), and loop.js mutates/returns the SAME array (loop.js:259/417) so the object identity survives. Live repro (real sidecar, temp WORKSPACES, mock provider): GET /api/transcript?stream=probe-stream returned `user "FIRST TURN about kittens" / assistant / user "FIRST TURN about kittens" / assistant` — the attachment turn's text is absent and the prior turn is duplicated — while GET /api/runs showed BOTH probe-stream rows titled "FIRST TURN about kittens". A control stream with plain string content recorded correctly, and the provider DID receive the real "SECOND TURN" text, so the fault is purely in the durable record. Same string-only shape confirmed at index.js:10032 (taskBrief.text) and 11405 (studyDirective); 11137 degrades the recall query. Not deliberate — the comment at 11302-11304 states the intent is to "Append the triggering user directive". Tests do not cover it: test/e2e.attachments.test.js drives POST /api/run with an attachment but asserts only that base64 reaches the mocked provider (never /api/transcript or /api/runs), and test/e2e.run.test.js:145's 'transcript captured the user directive' only ever sends string content ('hi'), so it passes without exercising the array shape.

_Found by the `sweep/sessions` lane, 2026-07-28. Finder confidence: high. Severity claimed P0, after refutation P0._

## Verdict

Current trunk already flattens multipart attachment content through latestUserText. Live seeded reload preserved the typed attachment turn, and e2e.attachments now proves the successful-run transcript contains prior/current user turns exactly once while run titles remain truthful.
