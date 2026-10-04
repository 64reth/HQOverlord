# Taste extraction — guess-first, react-don't-describe

Plan date: 2026-07-16 · extends docs/TASKBRIEF_V2_PLAN.md (all v2 lanes CLOSED).
North star (Andrew): extract the user's HUMAN TASTE — the clearer the vision extracted, the
better the output. Design law: **people reveal taste by reacting, not by describing.** A
correction to a wrong guess, in the user's own words, is the richest taste signal there is.

## The interaction ladder (ambiguity picks the mode)

1. Clear task → just go (unchanged).
2. Mostly clear → **announce-and-act (Slice 1)**: when the model settles its brief
   (brief_proceed), the settled read — objective + ASSUMPTIONS, including taste guesses —
   renders as a non-blocking READ card while the run continues. Tapping/typing a correction
   folds into the live run via the existing /api/run/steer seam. Zero interruption.
3. Material fork → brief_ask question chips (v2, unchanged).
4. Future: consequence lines per option; probe-first for creative work (produce a cheap
   variant early, harvest the reaction); consent-based "remember as taste" banking.

## Slice 1 (this pass)

- shared/events.js (additive, Andrew-approved lane pattern): `taskbrief.settled`
  { agentId, runId, objective, deliverable?, audience?, success?, assumptions[] }.
- index.js dispatch: a successful brief.proceed emits it (internal control stays hidden
  from tool telemetry; this event is the PRODUCT surface of the settle).
- fork.js taskDirective: brief_proceed assumptions must state the model's TASTE read
  (style/tone/aesthetic) as explicit, correctable assumptions.
- chat.js: on taskbrief.settled for the active stream → READ card: a "MY READ" caption +
  objective, assumption chips, inline correction input → POST /api/run/steer → "✔ folded
  into the run". Non-blocking; the run never pauses.
- Locked separations unchanged: task answers never auto-enter the dossier; steering is
  task-local. Durable taste banking stays consent-based (future slice).

Traps: shipped-surface ⇒ W0 re-stamp; taskintent source-guards; steer only lands while the
run is in flight (card must show honestly when the run already ended — disable input).
