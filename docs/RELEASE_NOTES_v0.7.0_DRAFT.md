# StarNet v0.7.0

> **DRAFT** — covers every lane merged after the v0.6.8 cut (published 2026-07-27 05:06Z).
> `release:bump` overwrites `RELEASE_NOTES.md` with a stub, so paste this in *after* the bump,
> then re-lock the claims surface as its own commit. Regenerate the delta with:
> `git log --oneline --first-parent v0.6.8..feat/harness-backend`

The station stops being a place where one agent answers, and becomes a place where a line of
them does the work — reachable from your editor, able to message out, and able to run your own
code at fixed moments. Along the way it stopped borrowing the operating system's furniture.

## The belts run the work now, not just the crate

A floor drawn `INBOX → researcher → writer → OUTBOX` used to run **only the researcher**. The
conveyor was a dispatcher: it picked one agent per inbound message, the bay ate the crate, and
every dock downstream was scenery.

- **A dock's output is the next dock's input.** The routing compiler emits the whole chain now,
  and one engine executes it on **all four surfaces** — channel messages, scheduled routines,
  Run Now, and a directive typed into the in-app COMMS composer. One floor, one answer.
- **A line can branch and merge.** A FILTER sends work down one lane or another on the output it
  actually got; a MERGER takes both inputs. The lane that didn't apply genuinely never runs.
- **It stops when you stop it.** E-STOP and per-stream Stop reach every stage, not just the one
  in flight. A chain is capped at 6 hops and $2, and every stop — failed stage, empty stage, cap
  hit — still delivers the last good output with an honest note instead of silence.
- **A loop is refused, not run.** Two docks feeding each other is an infinite chain of *paid*
  runs with no belt cycle to detect, so it's blocked at compile time.
- **Existing floors are unchanged.** A lone bay, or `INBOX → bay → OUTBOX`, behaves exactly as it
  did. The only difference for a floor you already drew is that belts drawn dock-to-dock now buy
  real runs.

## StarNet is reachable from your editor, and can message out

- **An editor can drive the station.** StarNet now speaks the **Agent Client Protocol**, so Zed,
  Neovim or any ACP client runs real station work — live tool list, file locations, and native
  approve/reject cards wired to the actual consent gate, not a copy of it. `npm run acp:serve`;
  see `docs/ACP_EDITORS.md`.
- **An agent can send, not just receive.** A placed DISH gains a `comms` toolset — an agent can
  list the channels you've connected and send to them. Deliberately **known targets only**: the
  message goes out under your own bot identity, so free-form addressing would turn any prompt
  injection into an exfiltration route.
- **An agent can manage its routines.** One action-shaped `routine.manage` — update, pause,
  resume, remove, run now. "Run now" fires now, instead of quietly re-anchoring the schedule to
  a day away. An agent can never hand its own routine an unattended terminal.

## Loops: work that repeats until it's right

The looping system shipped — and the half it is named after got built. The review gate ran no
git at all: an iteration's edits piled up **uncommitted** in your project, so approve promoted
nothing and reject undid nothing. The row said "rejected" while the code sat where the agent
left it.

- **Approve commits. Reject reverts.** For real, on a branch, with an undo plan.
- **Your own work is never swept up.** A pass stages only what the iteration itself changed —
  uncommitted work you had open before the loop started is never folded into a commit a later
  rejection would revert.

## Your own code, running inside the station

- **Hooks and plugins.** Two front doors — shell hooks and scoped JS plugins — onto one spine of
  nine events, each fired by a real call site. Written, approved, revoked and deleted from
  **ABILITIES › EXTENSIONS**, with no file to hand-edit. Nothing runs until you approve it there,
  and a hook may **deny** an action, never grant one.
- **MCP's other two thirds.** Connected servers can now offer **resources** and **prompts**, not
  just tools.
- **Thinking, on both native wires.** Extended reasoning works on the direct Anthropic and Gemini
  connections, not only through OpenRouter.
- **The agent reads your project's own instructions.** `AGENTS.md` and `CLAUDE.md` reach the
  model. Screenshots arrive as pixels. Read-only tool batches run concurrently. A stale-write
  guard refuses to overwrite a file that changed under the agent. Large outputs park instead of
  blowing the context. DOCX, XLSX and notebooks are readable.

## The station reads as a place

- **A room has four walls, not one.** Only the back wall was ever lit along its top, so the sides
  read as a floor edge and the station looked like it cut off. The lit crown runs the whole way
  round now — the same ladder of contact seam, face, under-seam, crown and outer edge on every
  side — so a room reads as enclosed at any zoom, in one room or a station full of them.
- **The corners hold that ring.** A top corner is the bottom corner lifted: one profile, no notch
  where curve meets straight, no waist where the ring narrows, and no stray shadow left in the
  void when a station has more than one room.
- **Crew stand in a shadow, not on a line.** The contact shadow under a body was a flat 9×2 bar.
  It's a soft foreshortened pool now that breathes with the idle bob and tightens when an agent
  sits down.
- **The CRT opens up.** The tube's aperture went from 50% to 68% of the panel and became a dial
  you can set — the feed had been painting nearly a quarter of the screen black inside the canvas
  itself, which no window resize could reclaim.
- **Props you look down at.** The camera looks down at the station, but the bed, the lockers and
  the three tables were drawn as if you were standing in front of them. Redrawn top-down. The
  crate and the bar were redrawn too, and props now sit **on** a table's surface rather than
  beside it.

## Nothing in StarNet is painted by your operating system

The station is one surface. Anywhere the browser or the OS still drew its own furniture inside
it — a grey button, a system font, a yellow tooltip bubble — the illusion broke.

- **The control floor.** Every button, dropdown, checkbox, slider and scrollbar is drawn in the
  station's own style on every platform, and the sweep that proved it is now a test — so a
  control that arrives white and Arial fails the gate instead of shipping.
- **Every input speaks in the station's font.**
- **Dialogs and tooltips are ours.** The OS tooltip bubble that appeared a second after your
  cursor stopped is gone; StarNet draws its own, immediately, in the same register as the panel.
- **PAINT became SURFACE**, and its palette was rebuilt — the deck-and-wall picker in REFIT had
  been raw HTML buttons sitting inside a pixel-art station.
- **See a skin before you choose it.** The dossier's CONFIG › SKIN shows a live preview of the
  crew member wearing it, instead of asking you to pick a name and find out afterwards.
- **The COMMS rail reclaims its dead space**, and the transcript stopped repeating itself.

## COMMS sounds like the station again

When the new sound pack landed, only 10 of its 36 cues were mapped. The ones left on the old
synth included the tick under *every* revealed line — roughly twenty times a second — which is
why the surface still sounded like the old board no matter what else changed.

- Every cue plays a pack file now; none are synthesised.
- Quest, level-up and milestone cues are level-graded, so the celebration isn't the quietest
  thing in the room.
- The composer stopped clipping its own placeholder, so the slash-command hint is readable.
- A run you stop says **RUN STOPPED** once, instead of echoing its own headline back at you.

## The station remembers, and shows its working

- **Memory forms on every real run**, not only the one you happened to be watching. Work done by
  a routine, a channel or a delegated worker leaves the same trace as work done in front of you.
- **A belief says where it came from.** Memory Core shows the run a belief formed in, and
  separates what the station is confident about from what still needs you — so a wrong belief is
  something you can find and correct rather than argue with.
- **Recall reaches every workstream.** `recall_conversation` saw only the open one; it searches
  across them now, which is what makes "what did we decide about X" answerable weeks later.
- **A new note can challenge an old belief** instead of silently stacking two opposite facts.

## Crew

- **An agent you asked for arrives with somewhere to work.** Ask the overseer to create a crew
  member and it's seeded with its own desk — adopting a free one, or building one. Recruiting
  from the Recruitment Bay is unchanged: you place that desk yourself.
- **Every polished skin can sit down.** The 26 redrawn skins gained sit frames.
- **The polished art is what installs.** A skin pack ships several states and the installer had
  been taking whichever sorted first rather than the finished one. `blank`'s face came back with
  the same pass, and the four `blank_*` recolours derive from it instead of drifting.
- **Blink is cut from an eye-constrained mask**, so closing the eyes no longer smears whatever
  else changed between a skin's old art and its new.

## Fixes

- **"Full access" means something again — in three places.** Granting a connector's tool full
  access was discarded, so the station asked the same permission on every call. Full access to a
  folder dropped a grade on the way in, so five reads inside one folder cost five clicks
  (measured: five cards became one). And a permission grade is no longer silently lost when the
  service backing it fails — authority is preserved rather than downgraded.
- **Revoking a project's trust is real.** A revoked project forgets, and no new session can start
  against it.
- **The undo net behind shell commands and file writes actually records something.** StarNet
  snapshots your workspace before every shell command, verify step and file write, so a bad edit
  can be rolled back. Two functions in the sidecar shared a name, so the snapshotter was silently
  handed the wrong one and **every snapshot failed without a word** — the restore list was always
  empty. It records now.
- **Voice stops dying after the first few words.** With voice on, an agent would speak its
  opening words and then go silent for the entire rest of the reply. A reply is spoken
  sentence-by-sentence, and a single failed chunk — one transient network blip on sentence two —
  armed a cool-off that sent every *later* sentence of that same reply straight to silence
  without even trying. A cool-off can no longer cut off a reply that is already speaking, and a
  sentence that plays successfully clears it. A genuinely dead voice provider is still backed off
  rather than hammered once per sentence.
- **`/tools` over Telegram stops claiming you have no tools.** It answered "this agent has no
  tools yet" for nearly every agent — it only counted tools from a conveyor bay, so any agent not
  docked in one read as empty, while that same agent's Telegram runs were being handed the full
  toolset the whole time. The readout now asks the same question the runs do.
- **The context gauge finally measures something.** The bottom-bar CTX readout sat at `—` with ten
  hollow cells forever. The station kept one model catalog shared across every provider, and it
  warms all ~17 of them at once — so whichever provider answered last, usually an unconfigured one
  with an empty list, wiped the catalog belonging to the one you were actually using. The window
  size for your live model then read as zero, so the gauge had nothing to divide by. Catalogs are
  per-provider now, and a real turn paints `11k / 200k`.
- **An oversized outbound message is refused**, not truncated into something you didn't write.
- **The selected skin is announced** in the dossier, so the picker is usable without sight.
- The ambient room shadow no longer darkens bare space at a corner, and the crown carries one
  constant width through a corner instead of thinning where two walls meet.

## Notes

- Windows installers are code-signed (CN=Andrew Sims), continuing from v0.6.5.
- **Windows: update from inside StarNet.** It installs over your existing copy — your crew,
  sessions, keys and station stay exactly where they are.
- **macOS: in-app updating works from v0.6.8 onward** — the mac updater legs
  (`StarNet_darwin-arm64.app.tar.gz` / `-x64`, plus their `.sig`s) are published alongside the
  DMGs, so INSTALL UPDATE resolves instead of 404ing.
- **StarNet stays MIT-licensed**, and the code is genuinely free to use commercially. The *name,
  logo and artwork* are not part of that grant — a fork is welcome, under its own name.
