# StarNet: first-use confusion journal

Date: 2026-09-04. Direction: improve the existing station dashboard and its existing categories. The separate My Work hub was the wrong response to the user's request: it duplicates destinations and adds another place to understand. This audit does not propose a replacement dashboard.

## Method and limits

I personally navigated the running app at http://127.0.0.1:8974/ using a novice perspective: What is this for? What should I do next? What do I expect this action to change? Where did the result go? These are cognitive-walkthrough findings, not measured reactions from independent novice participants.

This was an already-onboarded, disposable local replay fixture with NOVA, synthetic data, and Full Access enabled. Fresh installation/onboarding, real model quality, real third-party authentication, and real unattended execution were not tested. The fixture initially had a stopped server; it was resumed without reseeding. Fixture-generated response wording and seeded identity are excluded from product-quality judgments.

I opened the main menus, task board, deliverables, recipe browse/detail/setup, routine and loop setup, abilities/catalog/toolsets, quests, and Commander dossier. In Refit I tried invalid and valid cabinet placement, undo, line selection, invalid and valid Front Desk stamping, the step/agent editor, and inbox trigger configuration. I undid the cabinet and the stamped line. I did not assign an agent, save a routine, change access permissions, connect an account, or send an external message. Product code was not changed. Screenshots were inspected at approximately 632px browser width; width-specific observations below should be retested at larger sizes.

The journal records visible behavior and copy. Proposed remedies and predicted beginner reactions are judgments. Permission contradictions are UI findings; this walkthrough does not establish a backend authorization vulnerability.

## Main diagnosis

StarNet asks the user to assemble its operating model from scattered explanations. A single useful workflow crosses several conceptual boundaries: conversation versus workflow entry, bay versus agent, physical gear versus effective access, saved versus enabled automation, completed execution versus accepted output. Each screen explains part of that model, sometimes using different terms or rules.

The station can teach these relationships directly through the selected object, the current action, and visible work. Adding more destinations and long explanatory panels increases the work of understanding it.

Priorities: **P1** can mislead an important action, block a common journey, or undermine trust; **P2** causes hesitation or extra navigation; **P3** is secondary friction. IDs describe distinct hesitation points, not independently verified software defects.

## Arrival and navigation

| ID | Priority | Action and observed evidence | Novice hesitation | Small correction in the existing interface |
|---|---|---|---|---|
| 01 | P1 | Arrive at the station: COMMS is available alongside a physical station and Build tools. | Do I talk first, build first, or equip NOVA first? | Explain what the current agent can do now beside COMMS; introduce building when it changes the task the user wants to perform. |
| 02 | P1 | Open WORK: My Work, Tasks, Deliverables, Recipes, Automation, Quests all appear. My Work includes suggestions, progress, decisions, and results. | Which destination owns my work? | Remove the duplicate hub direction. Keep each established category responsible for its own purpose, with contextual links between related records. |
| 03 | P2 | Sessions and Projects sit in the rail; Tasks is in WORK; Recipes promises a fresh workstream. | Are session, task, project, and workstream different things I must create? | Use consistent user-facing nouns, and show the relationship on the existing task/conversation record. |
| 04 | P2 | Main screen says NOVA, crew, Commander, COMMS, and agent. | Who am I talking to, and who am I in this system? | Pair thematic labels with brief functional descriptions at first encounter; keep the identity and personality. |
| 05 | P1 | Initial stopped preview shows LINK DOWN / station unreachable while chat/build controls remain present; no nearby recovery action was apparent. | Can I still work? Will this be saved? How do I reconnect? | Put connection state, affected actions, and a recovery path together. The server stoppage itself was environmental. |
| 06 | P2 | COMMS has model selection and three voice controls, alongside slash-command affordance. | Which speaking mode should I use? Do I need to choose a model before asking anything? | Keep a clear default interaction and explain alternative modes when selected or focused. Do not require novice model expertise. |

## Building and prop placement

| ID | Priority | Action and observed evidence | Novice hesitation | Small correction in the existing interface |
|---|---|---|---|---|
| 07 | P2 | BUILD > REFIT STATION opens guidance beginning with drag a room, crew a bay, wire a belt. A room already exists. | Am I supposed to rebuild this before anything works? | Start guidance from the actual station state and the user's selected intention. |
| 08 | P2 | Refit toolbar contains Select, Room, Hallway, Surface, Prop, Belt, Lines, Move, Dupe, Delete. | What is structural, functional, or decorative? | Group related tools visually and make each selected tool's purpose apparent. Keep shortcuts available. |
| 09 | P2 | At the inspected narrow width, the toolbar crowds the right edge; DONE is partly clipped in the screenshot. Starter checklist, palette, and hover copy compete for space. | How do I finish, and where can I see what I am placing? | Keep exit/undo controls visible; let the selected tool own one compact guidance area. Verify responsive layout at this width. |
| 10 | P2 | PROP advertises 144 props, with Systems/Decor and categories including Workstations, Workflow, Capability, Isolation, Command. | Which one solves my immediate need? | Lead the functional palette with the ability or workflow action; show visual alternatives together after that choice. |
| 11 | P1 | STARTER GEAR 0/5 lists Files, Web, Terminal, Memory, Images and says everything else is optional. | Are these five mandatory before I can ask for useful work? | State which are needed for the current action and which are optional; do not imply a universal equipment checklist. |
| 12 | P1 | Placing Intel Cab produces “that just switched FILES on for me.” Toolsets later shows NOVA Full Access with file tools already active after the cabinet is undone. | Did the cabinet change permission or just the room? Which explanation is true? | Generate placement feedback from effective authority. In this mode, say access already exists and describe the actual placement effect. |
| 13 | P1 | Prop help says place it in your agent's room; step setup separately distinguishes agent, bay, and desk. | Whose room is this? Who receives the ability? | Highlight the affected room and agent while previewing placement, with the resulting scope stated explicitly. |
| 14 | P2 | Invalid cabinet click outside floor returns “must sit on a deck.” | Does deck mean room, surface, or the whole station? | Highlight the invalid footprint tiles and say what must change: for example, the entire object must fit on floor tiles. |
| 15 | P2 | Several props have the FILES badge; palette mixes desk variants and other functional-looking objects. | Does a more elaborate object give stronger access? Are these interchangeable? | Label equivalent capability variants and separate appearance from actual effects. |
| 16 | P2 | Clicking an occupied cabinet spot explains MOVE and DELETE; Undo works. | Will moving/removing it also change access, and for whom? | Preserve the useful contextual controls; preview any real access consequence before the geometry change. Runtime removal effects were not tested here. |

## Conveyor setup and execution

| ID | Priority | Action and observed evidence | Novice hesitation | Small correction in the existing interface |
|---|---|---|---|---|
| 17 | P2 | LINES says “Stamp a working line”; templates include Research Line, Front Desk, sorters, crew patterns, and quality gates. | Which is the smallest useful starting point for me? | Describe input, work, and result in each template preview; make the simplest applicable template easy to identify. |
| 18 | P1 | The template copy later says bays stamp empty and each needs an agent; Front Desk stamping confirms “now click each BAY to assign an agent.” | Why isn't this working after I placed a working line? | Call it a layout until configured; show remaining requirements before placing it. |
| 19 | P2 | Clicking inside the visible room to stamp Front Desk fails with “must sit on a deck”; the centered footprint extends beyond the floor. Repositioning succeeds. | I clicked the floor. Why was that invalid? | Make the template's anchor and footprint unmistakable, highlight exact invalid tiles, and offer a valid nearby position. |
| 20 | P1 | The finish checklist says “Inbox → 1 step → Check output route”; the editor reports no confirmed onward route while the stamped objects include inbox, bay, and outbox. | Is the belt broken, or do I only need to assign someone? | Distinguish topology, agent assignment, and missing instructions as separate concrete readiness reasons. This did not establish a routing-engine defect. |
| 21 | P1 | Step editor shows GENERALIST and INBOX > SORT > BAY > DESK > BAY > OUTBOX, plus “crew the docks.” | Is the step a bay, dock, desk, or agent? | Use one consistent name for the workflow step; use the other nouns only for distinct physical or runtime entities with visible relationships. |
| 22 | P2 | Step editor offers summon a generalist, NOVA, an agent identifier field, ASSIGN, UNBIND, and a job brief. | Should I create someone new or use NOVA? What must be filled in? | Make selecting an existing agent the obvious path when applicable; explain why a new specialist would help and show required fields together. |
| 23 | P2 | Job brief saves on blur/Ctrl-Enter, assignment uses ASSIGN, and editor exits with DONE. | Did that save? Does Done apply all changes? | Make saved/unsaved status explicit and keep the save behavior consistent across the existing editor. |
| 24 | P1 | Inbox explanation says only specific entry paths run the full line; a job handed directly to an agent stops at that agent's dock. | I built a workflow and typed to NOVA. Why would the other steps not run? | Put an obvious “Run this workflow” action on the selected line and explain the scope of a direct chat at the relevant entry point. |
| 25 | P1 | Refit TEST runs dummy crates; finish guidance separately offers a real sample job. | Did I test the AI work, or only the animation/routing? | Name the actions by their effect, such as “Preview routing” and “Run sample job,” with cost/execution implications where applicable. |
| 26 | P2 | FEED THE INBOX leads to routines/channels, NO FEED, new routine, connect channel, and manage in Automation. | What counts as a feed? Which connection will start this line? | Show the actual trigger and target in plain language on the inbox. Carry the selected line through setup and back. |
| 27 | P2 | “Loop” appears in workflow/template vocabulary and in Automation's repeated-job setup. | Are these the same kind of loop? | Qualify the specific behavior wherever the two concepts could be mistaken for each other. |

## Automation and capability setup

| ID | Priority | Action and observed evidence | Novice hesitation | Small correction in the existing interface |
|---|---|---|---|---|
| 28 | P1 | Active Routines clearly shows SCHEDULING OFF; Create Routine shows schedule dates on a separate tab. | If I save this, will it actually run? | Carry the scheduling-off state into creation and the saved result, beside the predicted schedule. |
| 29 | P1 | Routine setup says Workbench placement does not grant terminal access to routines; permission checkboxes appear separately. | Why did the prop say it enabled terminal access elsewhere? | Explain effective access for this execution context, with one direct way to resolve each missing requirement. |
| 30 | P1 | Routine warning says ungranted file writes are denied silently unless preapproved. | How would I know my scheduled work failed or how to fix it? | Make blocked work visible and actionable in its existing run record. Actual unattended denial behavior was not exercised. |
| 31 | P2 | Start Loop defaults to Build-Test-Verify, project/check command, and exit-code concepts. | Can this repeat ordinary research or administrative work? | Explain repeated-work purpose in everyday terms before developer settings; reveal details appropriate to the selected shape. |
| 32 | P1 | Abilities presents Toolsets, Catalog, Keys, MCP Connectors, Extensions, Skill Library, Agent Skills, Skill Exchange. | Which technical category does connecting my platform belong to? | Keep a service-oriented default within Abilities; place implementation-specific setup behind the selected service or advanced controls. |
| 33 | P1 | In Catalog, entering Notion in “Search abilities” still leaves unrelated catalog entries and a whole Skill Library panel in the accessibility/DOM snapshot on subsequent inspection. | Why didn't searching narrow this to the service I wanted? | Reproduce and fix search scope/results; show matches and a count. Observation is specific to this live build, not a diagnosis of the handler. |
| 34 | P2 | Catalog includes both Notion API-key and sign-in entries. The API entry sends the user to another Catalog connector; technical auth/header/env details are visible in browsing. | Which Notion is the right one? Must I understand APIs? | Present one service entry with its easiest supported setup and advanced alternatives inside it. Keep accurate setup limitations. |
| 35 | P1 | Toolsets shows Full Access even on a service described as not connected. Full Access refers to whole-computer scope; individual file copy mentions workspace scope. | Does full access mean ready? What can this agent actually reach? | Separate connected, permitted, and available-to-this-run states, with exact scope and one next action. |
| 36 | P2 | Toolsets says reversing Full Access requires clearing SKYNET_FULL_ACCESS and restarting. | Where can I control this? | Explain this launch-controlled mode clearly and provide the appropriate supported control/recovery path. This was a development-mode observation. |
| 37 | P1 | Skill Library says procedures remain gated by floor objects; Recipes says its listed gear is advisory and the recipe still launches without it. | Is the gear required or optional? Are a skill and recipe the same thing? | State the specific dependency and consequence per item. Explain a recipe as a job starter and a skill as reusable instructions, without making the user navigate elsewhere to decode the distinction. |

## Finding results, personalization, and game progression

| ID | Priority | Action and observed evidence | Novice hesitation | Small correction in the existing interface |
|---|---|---|---|---|
| 38 | P1 | Task board has ACTIVE 1 with DONE — REVIEW & SHIP and “1 ready to review.” | Is the agent finished or still working? | Use an explicit needs-review state for completed execution awaiting acceptance. |
| 39 | P1 | The task action is SHIP; Shipped column describes tasks the user marks shipped. | Will this publish/send something externally? | Label the state-changing action by its actual effect; reserve sending/publishing labels for actual external actions. |
| 40 | P2 | Deliverables says “Everything your agents actually made,” then its empty state clarifies it records file creation/changes. There are zero outputs despite an existing completed chat task. | Why isn't the answer I received here? | Explain file outputs versus conversation answers consistently and link each task to its actual result. |
| 41 | P2 | Deliverables offers pending, kept, implemented, discarded, produced, failed; Tasks uses queued, active, shipped. | Is produced the same as done? Is kept the same as shipped? | Explain each status at the record where it applies and standardize equivalent concepts. |
| 42 | P2 | Task archive recovery points to ARCHIVED in the COMMS rail. | Why must I leave the board to recover a task? | Give the board a contextual route to its archived records. |
| 43 | P2 | Recipes opens a 101-item library; choosing Summarize first shows a dossier with prompt, gear, tweak/export, then setup. | How many screens before I can just summarize something? | Lead the existing recipe detail with inputs and Run; move prompt inspection/tweaking to optional details. Preserve customization. |
| 44 | P2 | Recipes uses “fresh workstream,” “dossier,” CLASSES, and category tags such as OPS/CODE while browse categories say WORK/DEVELOPER. | Am I choosing a job, an agent class, or a technical capability? | Align category names and place the thematic detail behind a clear job-purpose description. |
| 45 | P1 | Quest Log simultaneously shows YOUR GOAL saved/path pending and NORTH STAR not set. | Didn't I already give you my goal? | Show the relationship between the saved goal and its milestones explicitly; avoid apparently competing goal states. |
| 46 | P2 | Open quests lead with recruit a specialist, wire a route, bind a tool portal; later prompts ask about pain points. | Must I expand the station before it helps me? | Order contextual guidance around the user's useful outcome; suggest equipment/crew only with a reason tied to that outcome. |
| 47 | P2 | Quest Log adds milestones, agent growth, Commander Journey, station evolution, outcome metrics, agent mastery, adaptation receipts. | Which progress system matters, and what should I do next? | Keep one clear current progression story in the existing view; put historical/detail dimensions behind expansion. |
| 48 | P1 | Recipes contains Station Familiarity, learning pause/forget and recommendations; Commander contains learned facts; Quests contains personal questions and goals. | Where do I see what you learned and how that changed your help? | Give each existing surface a precise responsibility and link recommendations to the evidence in Commander. Do not add another hub. |
| 49 | P1 | Commander says the dossier is local-first and “never leaves this machine,” while explaining agent briefings. Recipes says bounded summaries go to the configured model for recommendations. | Is my information local or sent to an AI provider? | Reconcile storage and transmission wording with the actual data flow. This is a visible trust/copy conflict; network behavior was not audited here. |
| 50 | P2 | Commander says Familiarity 0% and 3 of 9 dimensions known; Recipes reports two signals and a work-mix percentage. | How can you know three things about me but know me zero percent? | Explain what each measure represents, or avoid redundant percentages that appear contradictory. |

## What already helps

- The station provides an immersive, spatial representation that can make work understandable when selecting an object reveals its real role.
- Menu subtitles already try to explain each category's purpose. Preserve this concise guidance while correcting the overlaps.
- Prop badges, placement previews, contextual move/delete instructions, and Undo provide useful feedback. Strengthen their precision and scope.
- The stamped-line completion checklist is a useful foundation: assignment, input, and sample run. Its status must identify the actual missing step accurately.
- Routine setup has human-readable schedule options and an explicit timezone. Scheduling Off is honest and useful; carry it across the flow.
- Recipe launch has understandable inputs and Run Now / Make Routine. This is a good core flow that can become more direct.
- Editable learned facts, provenance, pause/forget controls, and explanations that levels do not gate abilities are valuable. Make these controls and explanations consistent.

## Recommended first cleanup pass

1. **Restore clear ownership to the existing categories.** Retire My Work as a duplicate destination; preserve the station as home. Give Tasks, Deliverables, Recipes, Automation, and Quests short, consistent purposes.
2. **Make props truthful and predictable.** A selected object should show what it does, who it affects, whether it changes effective access in the current mode, and exactly why placement is invalid. This needs runtime-derived state, not only copy edits.
3. **Make each conveyor self-explanatory.** On its existing selection panel, show what starts it, who performs each step, where the result goes, and the first unmet requirement. Make routing preview and real execution visibly distinct.
4. **Close the gaps between connected, permitted, ready, running, and finished.** Keep state and the action that resolves it together. Use clear review/completion language and take users directly to the relevant result.
5. **Make depth optional within the current interface.** Default to purpose and next action. Expose exact prompts, IDs, transport choices, budgets, and detailed progression on demand. Personalization should explain a concrete suggestion from known context and let the user correct it.

These are cleanup priorities, not a request to introduce another onboarding layer or simplify away customization. Preserve the station's personality; require less memorization of its operating rules.

## Acceptance criteria for a later implementation

Ask an actual beginner to perform these tasks without explanation from the developer, and record hesitation, wrong turns, and recovery:

1. Ask NOVA for useful work and identify whether any setup is required.
2. Place a functional prop and correctly predict its effect on the selected agent; recover from invalid placement without a manual.
3. Configure a simple line, identify what starts it, preview routing, and run a real sample without confusing the two.
4. Identify why a saved automation will or will not execute and fix its first blocking requirement.
5. Connect a service through its supported setup, understand its scope, and return to the original task.
6. Find an answer/file, identify whether work needs review, and mark it complete without fear of accidental publishing.
7. Explain what StarNet knows about them, correct one belief, and understand why a suggestion appeared.

Separately verify narrow and wide layouts, keyboard navigation, fresh onboarding, normal restricted authority, Full Access, real connector authorization, and real background runs. This walkthrough did not complete those coverage areas.
