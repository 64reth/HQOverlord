# Conveyor Guided Workflows — the beginner-first agentic graph plan

> **Thesis (Andrew, 2026-08-05):** the conveyor is the easiest agentic-graph builder for beginners
> in the AI space — but today we ship the SHAPE of a workflow without the WORKFLOW. A stamped line
> is topology; the user still faces three invisible questions: *what work comes in? who does each
> step? what do I do to make it real?* This plan makes every element of the floor answer its own
> question, with StarNet holding the workflow in its head FOR the user.

**Prior art on trunk (2026-08-04):** conveyor audit closed 11/11; blueprint shelf (`⇉ LINES`,
tool 9, `WorldModel.BLUEPRINTS`/`stampBlueprint`), self-narrating first ride (fires at BINDING,
never at stamp), the one-sentence mental model, LINES shelf v2 presentation. This plan builds on
those; nothing here re-opens them.

**Design law for everything below:** truthful telemetry. Guidance may PROJECT (clearly marked
"would"), but the floor never asserts state the harness can't prove. Guidance is suggestions the
user accepts — never gating, never grind (sandbox law).

## Phase 1 — MEANING: docks carry roles
Blueprint bays stamp with a ROLE, not blank: `role` (+ short "does what" line) added to the
BLUEPRINTS catalog entries (RESEARCHER "digs sources", WRITER "drafts the result", SORTER
specialists, CREW workers, SHIPPER). The bay's placard/hover shows the role while unbound.
Clicking an unbound role-carrying bay offers **"SUMMON A RESEARCHER HERE"** — one click creates
an agent with that purpose (reuse the existing summon/recruit machinery + class loadouts; model
inherits the station default) and binds it to the dock. Manual pick stays available (the role is
a suggestion, not a gate). *Answers: who does each step?*

## Phase 2 — PATH: the finish-the-line card
After a stamp (and for any drawn line that compiles incomplete), a checklist card anchored to the
line, each item honest, clickable, and derived from the COMPILED PLAN + real harness state:
  ① CREW THE DOCKS (N left) → clicking focuses the next unbound bay and opens its picker/summon.
  ② FEED THE INBOX → real state: channel connected? routine targeting a dock agent? Offers the
     two real paths (connect a channel / create a routine). Skips itself when a feed exists.
  ③ RUN A SAMPLE JOB → enabled only when ① is done; fires Phase 4's sample.
The card retires permanently for that line when its first real crate DELIVERS (event-driven, not
time-driven). Never blocks editing; dismissible; per-station persistence beside the first-ride
flag. *Answers: what do I do next?*

## Phase 3 — PICTURE: ghost projection
While a line is incomplete (compiles, but uncrewed/unfed), a clearly-projected crate loops the
route: dashed/translucent chassis, distinct from every real cargo type, with small conditional
captions at each stage ("a message WOULD arrive here", "your RESEARCHER would run it", "the
result WOULD ship out"). Driven by the compiled plan (same routing the real crate would take,
including filter/splitter lanes). Stops the moment the line goes live (real crates own the belt).
Deterministic (injected clock), no RNG. *Answers: what will this actually do?*

## Phase 4 — PROOF: run a sample job
A button (checklist item ③ + on the line's INBOX card) that feeds ONE real, cheap, clearly-labeled
work item through the whole line via the REAL dispatch path: unaddressed inbound → router
resolveTarget (filter/splitter decide) → dock run → chain hops → OUTBOX delivery. New small
sidecar seam (POST /api/routing/sample): production-gated like any API route, one-in-flight per
station, sample text canned per blueprint role family, runs through runOnce (real budget governor,
real ledger, real cost = real crate mass). The reply lands in the OUTBOX like any delivered run,
labeled SAMPLE. *Answers: does my system work?*

## Phase 5 — CERTIFY: the beginner gate
1. Fix the TEXT SIZE AUTO overflow (vh-sized REFIT dock renders past the glass, hiding palette
   tails) — precondition for any beginner claim.
2. Beginner Run QA pass aimed at this exact path: fresh seed, zero coaching, target = stamped
   line → crewed via summon-here → sample crate delivered, in under five minutes. Findings become
   fix-lanes; the claim "easiest agentic workflow builder for beginners" is made only when this
   pass is green.

## Execution
Lane sequence (each: own worktree, `npm run test:fast` green, sync:website, claims re-lock at
merge, PNG proof shots): **A** = Phases 1+2 (one lane — roles and checklist share the guidance
surface) → then **B** = Phase 3 and **C** = Phase 4 in parallel (B is frontend conveyor/world;
C is sidecar + a button) → **D** = text-size fix → **E** = Beginner Run pass + fixes. Merges
serialize through the integration tree per the merge ritual.
