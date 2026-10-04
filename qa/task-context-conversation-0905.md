# Conversational task context — 2026-09-05

User-approved scope: concrete experience questions, extracting the whole answer, adaptive
follow-ups, provisional examples, and stopping once the next useful action is clear. Extend
the existing Task Brief rather than introduce a separate interview service or agent loop.

Implemented: optional-choice conversational questions, durable quoted working understanding
with separate assumptions/unknowns, a required update after each answer before another question
or execution, bounded discovery and a delegation escape. Workers read the latest context when
dispatched. Legacy choice calls remain supported. The COMMS card has a multiline editor,
append-only shortcuts, draft sample, expandable understanding and compact answered receipts.

## Source-app evidence

Driven in the real seeded frontend/sidecar at localhost:9198 with a deterministic local model
fixture. This exercises real brief tools, consent HTTP, durable storage and a local fs.write.
It does not measure how reliably a production model extracts meaning from arbitrary answers.

- Asked “Walk me through the last client update you sent…” with no mandatory choices.
- Entered a freeform Slack/Google Doc workflow with chasing missing details, late replies and
  “Never send updates without my review.” Ctrl+Enter submitted the complete reply.
- The next card showed a provisional client-update table and expandable interpretations anchored
  to verbatim user quotes; assumptions were separately labeled. Answered card folded into a receipt.
- DOM layout: card width 312px, scrollWidth 308px; no horizontal overflow in narrow COMMS.
  Editor background rgb(3,2,1), border rgb(185,121,28), text rgb(255,170,51); themed controls.
- Deliberately stopped and restarted the sidecar while question 2 was unanswered. The live check
  caught a preexisting automatic-recovery bug that used the original request as an answer.
  Fixed recovery to preserve the brief and defer automatic continuation while awaiting the user.
- Repeated restart proof: brief `tb_017f8995-252c-41c5-9d1a-32d8da7e9971` remained clarifying,
  question 2 answer stayed empty, context revision stayed 1, and the sample/editor reappeared.
- Entered “Use a short table, and add an owner column.” and clicked Use your judgment. Both the
  typed text and delegation survived. Same brief advanced through update -> proceed -> fs.write;
  UI showed RUN COMPLETE (474ms). The stored snapshot added the owner-column interpretation.
  The fixture writes a fixed local template, so this proves lifecycle/context transport rather
  than production-model output quality. It sent no external messages and created no Google Doc.
- “Reply with the word ready” completed immediately (95ms, zero lead tool calls) with no questions.

## Regression coverage

Task conversation tests cover complete long answers, fabricated-quote rejection, stale snapshots,
extraction before follow-up/proceed, optional sample, delegation, question budget and recovery.
UI tests cover text-safe rendering, non-destructive shortcuts, failed-send text retention and receipts.
HTTP regression boots twice and reads full answers/context/samples back, accepts a larger request
body, rejects stale receipt claims and preserves legacy answer responses. Worker regression proves
the most recent in-turn context reaches the dispatched worker. Full gate receipts recorded below.

No installed-app build, production provider comparison, or release-readiness claim is made.

Combined candidate (includes customer reliability trunk `f9fa70cea`):
`run-fast-tests: OK — 719 step(s) green` and `run-test-list: OK — 98 step(s) green`,
both processes exit 0. Logs: `dev/context-final-fast.log`, `dev/context-final-http.log`.
Final source restart recheck also showed one pending card, zero stale retry buttons, and
first-question delegation completing in 566ms with one question total and context revision 1.
Browser console check found no TypeError. Source syntax and renderer-mirror checks passed.

## Integration receipt

Merged into `feat/harness-backend` as `b62ccd22a`, from snapshot `f8b31d2d8`.
The committed tree exactly matched the verified branch. Existing unstaged `qa/STATUS.md`
and untracked `docs/HANDOFF_ROOMS_2026-09-04.md` passed byte-for-byte preservation checks.
On uninterrupted merged trunk, standard gates both exited 0:

- `run-fast-tests: OK — 719 step(s) green` (`dev/context-trunk-fast.log`).
- `run-test-list: OK — 98 step(s) green` (`dev/context-trunk-http.log`).

This completion update changes documentation only. Local proof artifacts remain in the worktree;
temporary source-app processes and browser tab were closed. No push, installed build or release.
