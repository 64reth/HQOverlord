# StarNet v0.6.7 — DRAFT release notes

> **This file is a staging draft, not the shipped notes.** At cut time its body (everything
> below the `---`) replaces the scaffold `release:bump` writes into `RELEASE_NOTES.md`.
>
> - Covers trunk `feat/harness-backend` from tag `v0.6.6` through **10d837d0**
>   (142 substantive commits; qa/claims/status commits excluded).
>   The body through `62706fb9` was written 2026-07-25; the delta `62706fb9..10d837d0`
>   (browser instrument, request cost, Commander commands, station defaults) was appended
>   2026-07-26.
> - **DELTA `10d837d0..91f3c5b1` WRITTEN UP 2026-07-26** — security sweep, delegation +
>   conveyor honesty, idle continuity, props/tables, the FOR YOU shelf, and the MIT/branding
>   position. **The body is now complete through `91f3c5b1`.**
> - **THE SKIN LANE IS IN (`d427da54`, `ff3c3362`). The body is COMPLETE through `dfc8b6ec`
>   and ready to paste.** Note the two edits it forced: beachbabe was dropped from the
>   north-walk list (it no longer exists), and the retirement of Beach Babe + Steve is called
>   out because an agent wearing either silently falls back to the default skin on first launch.
> - If anything else lands before the bump, re-run:
>   `git log --oneline dfc8b6ec..feat/harness-backend --no-merges | grep -vE "^[0-9a-f]+ (qa\(|docs\(status|chore\(status)"`
>   and append the user-facing ones to the matching section.
> - Every claim below was checked against code, not against plan docs.

---

# StarNet v0.6.7

The station gets places to be, and your phone gets real control of it.

## The station is a place now

- **Four skies to park under.** The backdrop behind the station is a choice: **THE VOID**
  (the default, unchanged), **THE NURSERY** (inside the gas cloud instead of looking at it
  from outside), **OCEAN**, and **NIGHT CITY**. Pick one in the world settings; the camera
  parallax follows the station the way it always did.
- **Your station will look different the first time you open it, on purpose.** The default
  deck moved from **PLATE** to **SPINE** (big staggered plates with a real hierarchy instead of
  a uniform grid of identical slabs), and the default wall moved from **PLATING** to
  **BULKHEAD**. Both changes reach stations that already exist, because a station that never
  picked a floor was showing the old default — and the old default had aged. **Nothing was
  removed:** PLATE and PLATING are still in the palette as the classics, one click away in the
  build menu if you preferred them.
- **Decks you can actually choose.** The floor is now a hue *and* a material: the original
  PLATE / PANEL / TILE / TREAD / MATTED plus SPINE and four more — **GRATE**, **HEX**, **PLANK**
  and **TURF** (which now reads as real matted grass rather than green carpet). A separate knob
  controls how hard the joint between plates reads, so a deck can be seamless or heavily
  panelled.
- **Walls got the same treatment.** Per-room colour, taller wall faces, and new wall materials
  including **VIEWPORT** — which doesn't paint the wall, it cuts a hole in it, so the live
  drifting starfield behind the station shows through.
- **Rounded corners are actually round.** Every rounded corner is drawn from one shared
  integer curve now, so the wall and the deck agree on where the corner is: no jog where the
  curve hands off to the straight wall, no bright one-pixel seam beside the side walls, no
  rim left hanging in the void.
- **116 props re-materialled.** The whole prop catalog got a v4 pass so props sit in the same
  light as the room they're in. The chair reads as a chair.
- **Props stand on tables.** Three real tables arrived, and a prop placed on one sits on its
  surface instead of hovering beside it. The poker table was rebuilt from scratch — it had been
  reading as a monitor on a stand — and six more props whose art read as the wrong object
  entirely were redrawn. Eleven props that never worked were retired, so the catalog is smaller
  and everything left in it is worth placing.
- **Crew at rest look like they're thinking, not lost.** An idle agent keeps its attention on
  what it was last doing and shows an intent tell, instead of drifting aimlessly. Two related
  bugs went with it: an agent could be teleported home mid-stride by the containment backstop,
  and an agent's attention anchor survived a re-frame it should not have.
- **Eleven new skins.** Freddy, Ghostface, Morpheus, Rick, Ninja Turtle, Robocop, Minion,
  Master Chief, Pikachu, Casey Jones and Finn. Five older skins (bear, pepe, capybara,
  crthead, heisenberg) had no back-frames when walking north — they do now, and
  four more (ghostface, ninjaturtle, minionchar, finn) had their north-walk cycles rebuilt.
- **Twenty-eight skins redrawn.** Every redrawn skin was rebuilt from its *original* character
  rather than re-prompted from a description, so builds are preserved structurally: heights are
  unchanged everywhere and the worst drift on any skin is two pixels on one axis. Your crew
  stands exactly where it stood. Each skin's blink is now derived from its own new idle pose,
  so it can never disagree with the pose it interrupts.
- **Two skins were retired: Beach Babe and Steve.** The catalog goes from 38 to 36. If one of
  your crew was wearing either, that agent falls back to the default skin on first launch —
  nothing else about them changes, and you can pick any of the other 36 from the dossier.

## Your phone is a real console

- **One Telegram contact per agent.** Bot profiles bind to a specific crew member, so you can
  message the agent you actually want instead of routing everything through one bot.
- **Thirteen commands, not six.** `/stop` ends the run in progress, `/new` forgets the chat's
  history, `/status` says what the chat is doing right now — plus `/usage` and `/tools`
  answering from the station's real ledger, and `/routine` and `/away` for scheduling and
  queueing work. They run through the same command registry the desktop app uses, so a
  command can't quietly mean two different things in two places.
- **Tappable choices and approvals.** When an agent asks you to pick something, Telegram shows
  buttons. Approve/deny buttons for tool permissions are available per chat with
  `/approvals on` (off by default). If a keyboard can't be delivered, the request is denied
  immediately instead of hanging.
- **It shows you it's working.** A typing indicator runs for the whole time a run is in
  flight, not just the first few seconds.
- **The bot follows the roster.** A bot's identity, model and provider are read from the
  agent's dossier live — renaming or re-modelling an agent no longer leaves its bot frozen at
  whatever it was when you connected it.
- **A first message to a stopped bot gets answered** instead of being swallowed.
- **A CHANNELS window** in the console shows every platform, its live status, and its own
  pane — no more hunting through settings.
- **Low OpenRouter credit self-heals** instead of dead-ending the chat on a 402.

## Commands that don't lie

- Slash commands execute on the station instead of being guessed at in the browser, and
  `/routine`, `/away` and `/loop` join the set.
- `/usage` and `/tools` answer from the sidecar — real spend, and the tools this agent can
  genuinely call.
- `/reasoning` and `/fast` move the actual dial instead of announcing that they can't.
- A command can no longer be declared in one place and silently missing in the other; a guard
  test holds the two registries together.
- **Write your own commands, and put them on a clock.** A Commander-defined command is yours —
  name it, give it the prompt, and it appears in the palette like a built-in. Any command can
  also be scheduled, so `/…` becomes a routine without leaving the chat.
- **The palette completes argument values**, not just command names, so you stop guessing what
  a command will accept.

## Agents can reach further

- **`web_request`** — an agent can call a third-party API directly, without going through a
  shell.
- **`web_fetch` stopped burning attempts** on a keyed proxy nobody had a key for.
- **Attended browser login.** You log in to a site yourself, in a real browser window; the
  agent then does its research signed in. The browser also no longer announces itself as
  automation on launch — which is what was making Google refuse the sign-in that made the
  whole flow pointless.
- **Service keys the model knows about.** An agent is told which keys it can actually spend,
  and a key you paste now reaches the shell the agent runs in.
- **The model is told the truth about its own reach** — what it can and can't touch on the
  surface it's running on, instead of discovering it by failing.
- **Unattended runs can be trusted with more.** A routine can now be granted the terminal and
  your connected MCP tools, so scheduled work isn't limited to what a chat could do.

## The browser became an instrument

The agent's browser stopped being a page-loader with a screenshot button.

- **Screenshots are deliverables.** A screenshot an agent takes is saved and handed to you
  instead of being described and thrown away.
- **Popups and new tabs work.** A link or a script that opens a second window used to be
  blocked outright; now the new target is adopted as a drivable tab, and the agent can list,
  switch and close tabs.
- **It can fill in the hard parts of a page** — hover, select from a dropdown, drag, resize
  the viewport, go forward — not just click and type.
- **Files go both ways.** An agent can upload a file to a page, and a file it downloads lands
  inside its workspace instead of somewhere it can't reach.
- **It reads what it's actually looking at.** Page snapshots and text extraction see inside
  iframes, a bounded inspector answers questions about the page structure, and a network
  request log means "it did nothing" is now a checkable claim rather than an argument.
- **It reports the real HTTP status.** A 404 or a 500 is a 404 or a 500, not a page that
  "loaded".
- **It waits for the page instead of sleeping.** Actions wait for the thing they need, which
  removed three fixed delays — pages that were slow now work, and pages that were fast are
  faster.
- **A cross-origin iframe can no longer wedge the whole page**, and running JavaScript on a
  page is gated on which browser profile is live, so it can't be aimed at a session holding
  your logged-in credentials without that being a deliberate choice.
- **Tool results are treated as data, not instructions.** Text an agent reads off a web page
  or a tool result can no longer act as a command to that agent.

## Nothing can hang the station, and nothing can talk it into things

An adversarial sweep went looking for ways to freeze StarNet or steer an agent using nothing but
content it was asked to read. Everything below was a real hole, and every one of them is now
pinned by a regression test.

- **A hostile page can't freeze the station for minutes any more.** `web_fetch` had no bound on
  how long a page could hold it; a search result could stall the whole process. Both it and the
  search-result reader are bounded now.
- **A model-supplied regex can't lock the process.** `fs.search` accepted a pattern straight from
  the model — the classic catastrophic-backtracking hang, reachable by an agent that had simply
  been told something clever by a web page.
- **Text an agent reads is data, never orders.** The guard now sees the invisible characters that
  were being used to smuggle instructions past it, and a tool result can no longer act as a
  command to the agent that fetched it.
- **A model-supplied key can't reach `Object.prototype`.** Prototype-chain names in a lookup are
  refused instead of resolving to something the code never put there.
- **The file jail holds everywhere.** `fs.search` had a different idea of the boundary than the
  rest of the toolset, plus four allowlist and comparison defects alongside it; the protected-file
  floor is now proven against the real resolved target rather than the path as typed.
- **The MCP connector's OAuth endpoint guard closed its server-side request gaps.**

## Crew work that finishes

- **A delegated subtask is never dropped in silence.** The overseer→crew path could lose work and
  report success; it can't now.
- **A slow worker no longer destroys the whole dispatch.** Each worker gets its own wall clock and
  partial results survive, instead of one straggler taking the batch down with it.
- **The full crew gets used.** Asking more workers than the fan-out could take used to refuse half
  of them outright; the dispatch runs in waves instead.
- **A delegated worker is told its real approval posture**, so it stops trying things the station
  was always going to deny.
- **A MERGER funnels lanes instead of faking a combine.** The conveyor's merge step claimed to
  combine its inputs and didn't — what came out was one lane's work wearing the label of all of
  them. It also survives a cycle without blowing the stack, takes orphaned intake non-fatally, and
  applies real backpressure to its source.

## Runs cost less, and the number is honest

- **Roughly a third less is sent on every single request.** The station used to describe all
  72 of its tools to the model every turn (37.7 KB); it now advertises the ones that matter and
  lets an agent look the rest up on demand (29.7 KB). Nothing was taken away — the tools are
  all still there and still callable.
- **The unchanging part of a request is cached** on Anthropic models rather than being re-billed
  every turn — 59.7% of a typical request stops being paid for twice.
- **Reported spend is accurate again — in both directions.** Cached tokens were being priced as
  if they were fresh, which would have inflated the figure; that fix shipped alongside caching
  itself, so no build ever showed you the inflated number. The under-reporting was real, though,
  and this release ends it:
  - **The station could record $0 for a run that genuinely cost money.** If it ever started
    without a working connection, three of the four providers cached the failed price lookup as
    permanent — so for the rest of that session every turn was "unpriced", the ledger logged
    nothing, and **your daily and global spend caps never fired**. The lookup now retries.
  - **Token counts ignored tool-call arguments**, which in an agentic run are routinely the
    largest thing on the wire. A 40 KB file write measured as 32 tokens against roughly 10,000
    real ones. Counting is now one shared rule everywhere.
  - **Context-compaction savings were computed across two different units**, so the "removed"
    figure on a fold was fabricated and the safeguard that stops a degraded run from paying for
    a summariser every turn could never trigger.
- **Terminal output arrives readable.** Colour codes from shell commands are stripped instead
  of being fed to the model as noise.
- **One enormous tool result can no longer end a run.** Output that nobody bounded — including
  results from a connected MCP server — is capped at the one point every result passes through,
  keeping the head *and* the tail so the error at the bottom survives.

## Fixes

- **Editing an agent's instructions no longer wipes another agent's.** In v0.6.6, the four
  `.md` editors in a crew member's dossier were the one per-agent control that never said
  *which* agent it was editing — so edits landed on whichever agent was focused and
  overwrote that one's document. This is the "context always erases to zero" report. Solo
  stations were never affected; it needed a crew to reproduce.
- **Re-purposing a specialist updates the lead's crew line** instead of leaving a stale
  description behind.
- The per-agent cards in the dossier's CONFIG tab had no card styling and ran together.
- **The cap that stopped a run is named**, so a run that halts tells you which limit it hit —
  and the default caps are set for a beginner instead of an expert.
- **Task Brief** no longer asks about dimensions the Commander always defers, no longer offers
  a fake three-way choice between near-identical options, shows that a typed answer is
  allowed, and grounds its ★ recommendation in observed history. An adversarial review of the
  lane also closed an inversion, a permanent latch and a denial-of-service path.
- The "my read" card in COMMS no longer renders in the tool-line register.
- The KEYS and CATALOG panes went through an honesty pass — including a platform directory
  that answers "what can I connect this to?"
- **Crew move smoothly.** Agents walking the station were snapping between whole tiles; they
  now draw at sub-tile positions with an eased gait and smoothed paths. The sprites never
  changed — the movement did.
- **Inert scenery stopped faking telemetry.** Props that do no work had blinking status lamps
  on them. A blinking light on this station means something is running; spending that signal
  on a shelf made it meaningless. The lamps are gone from decor that isn't doing anything.
- **Gemini models stop rejecting tool calls.** Tool schemas are sanitized for Gemini's wire
  format, including no-argument tools, which that API refuses in the standard shape.
- **You're warned before your balance runs out**, not after a run has already been refused —
  and only if you're on managed credits; a bring-your-own-key station never sees it.
- Two corner-drawing fixes: the ambient room shadow no longer darkens bare space at a corner,
  and the crown where two walls meet is tapered instead of blunt.
- **Telling the FOR YOU shelf what you don't like no longer empties it.** Enough honest negative
  feedback could rank every remaining suggestion below the cut-off, so the shelf went blank and
  looked broken. Being picky now narrows the shelf instead of deleting it.

## If you were affected

If you have more than one agent and you edited a dossier document in v0.6.6, the text may have
landed on a different crew member — whichever one you were chatting with at the time. The update
stops that happening, but it cannot move misplaced text back. Open each crew member's dossier ›
CONFIG and check that `context.md`, `purpose.md` and `operating-manual.md` read the way you meant.
Your overseer is the likeliest place to find something you wrote for a specialist.

## Notes

- Windows installers are code-signed (CN=Andrew Sims), continuing from v0.6.5.
- **Windows: update from inside StarNet.** It installs over your existing copy — your crew,
  sessions, keys and station stay exactly where they are.
- **macOS: download the installer manually this one time.** In-app updating has never actually
  worked on macOS — the feed advertised builds that weren't published, so INSTALL UPDATE failed.
  This release publishes them, so from v0.6.7 onward the Mac updater works like the Windows one.
- **StarNet stays MIT-licensed**, and the code is genuinely free to use commercially. The
  *name, logo and artwork* are not part of that grant — a fork is welcome, under its own name.
