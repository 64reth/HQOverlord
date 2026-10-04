# StarNet clarity plan

Status: approved plan. The 2026-09-05 implementation makes an incremental clarity pass in the existing interface; see `STARNET_BEHAVIOR_CONTRACT.md`. Outcome validation with fresh users remains outstanding.

## Objective

Make the existing station understandable through normal use. A beginner should know what they can do now, what each visible object is for, whether they need it, who it affects, and how to get from an intention to a useful result. A power user should retain direct control over the same system.

The central concern is understanding the operating model. Invalid placement feedback is a supporting fix, not the organizing priority. Success is users correctly predicting what StarNet will do and completing useful work with little help.

The station remains home. Preserve its pixel-art world, crew, meaningful equipment, conveyors, existing categories, and customization. Retire the duplicate My Work destination after transferring any unique useful actions into their existing category. Preserve saved work and configuration. Guidance should use existing selection panels, COMMS, and tutorial machinery.

## Grounding and a correction to the earlier audit

The [walkthrough journal](NOVICE_WALKTHROUGH_2026-09-04.md) records an expert cognitive walkthrough of an already-onboarded local replay fixture, not an independent beginner study. Treat its findings as testable evidence and hypotheses, not population statistics.

Current trunk source was checked during planning at the observed `e9e210a24` revision; the repository moves quickly and must be checked again before implementation. There is a substantive conflict to resolve before writing definitive prop instructions:

- `docs/DECISIONS.md:35` says specialists own only their desk and other equipment is shared through the overseer; it explicitly rejects per-agent prop kits.
- `frontend/app/tutorial.js:906` tells users to put the same gear in a crew agent's room.
- `frontend/app/world.js:9366` distinguishes a bay-assigned room's tool reach from the station-wide equipment used for skill availability at `stationCaps`.
- `sidecar/capability/resolve.js` resolves tools from an assigned room. `office.js` gives interactive and headless contexts different starting objects. `sidecar/index.js` adds execution-profile, unattended, and Full Access grants.
- `sidecar/capability/effective-toolsets.js` already describes effective grants and their source. Its own header correctly says it does not establish service availability or a particular run's task policy.

Therefore, neither “put everything in every room” nor “everything anywhere always works” is an acceptable blanket explanation. The first delivery must reconcile product intent, actual runtime behavior, and user-facing explanations. Any discrepancy must be resolved and live-proven, rather than hidden behind simpler wording. Do not silently broaden explicitly restricted scopes while reconciling sharing.

## 1. Establish the small set of rules the interface will teach

**Deliverable:** a one-page behavior contract and a verified matrix covering lead/specialist, assigned/unassigned bay, direct chat/workflow/delegated/scheduled work, and normal/Full Access modes. This is implementation groundwork, not a screen users must study.

For each concept, write one functional description, then identify the exact information needed to act:

| Concept | Description to communicate | Question its existing UI must answer |
|---|---|---|
| Agent | The AI worker doing the task | Who will do this, and what can they use now? |
| Props | Equipment that represents particular abilities, plus clearly marked decoration | What does this provide? Is it needed? Is an equivalent already available? |
| Room | A space organizing the station, with any real scope effects shown explicitly | Does putting this here change who can use it? |
| Conveyor | A reusable sequence of work steps | When does this run, who does each step, and where does the result go? |
| Recipe | A ready-made job to start | What do I supply, and what will I get? |
| Skill | Reusable instructions an agent follows | Does it already apply, and does it require anything else? |
| Routine | A job set to happen at specified times | Is it enabled, when will it run, and where will I see the result? |
| Connection | Access to an outside service/account | Which account, what access, and is it usable for this task? |

Use one canonical term per concept. Keep thematic names as recognizable names, paired with practical descriptions. Avoid exposing desk/bay/dock as interchangeable names for a single workflow step. Keep messaging entry points distinct from services the agent uses.

For equipment, explicitly settle and prove: when one instance suffices; which variants grant the same ability; how sharing through the lead works; what room assignment changes; what a second copy does; and what removal affects. The UI must answer these questions without requiring duplication experiments.

**Done when:** the product contract, runtime checks, and displayed explanations agree across the matrix. A read-only, run-aware explanation should reuse existing capability/connection authorities; it must not become another permission system or a second independent grant calculation.

## 2. Make the station and its objects explain themselves

**Deliverable:** an incremental update to the existing agent, prop, room, and workflow selection panels plus the prop palette.

Every selection follows the same compact pattern:

1. **Purpose:** one sentence explaining what it does for the user.
2. **Current effect:** who it affects and what is available now.
3. **Next action:** the first useful action, if anything is missing.

For a file prop, the useful information is “read and create files,” its actual recipients/scope, whether the ability already exists, and the effect of another copy. The exact labels must derive from step 1. A valid example in Full Access is “File access is already available to NOVA”; it must not celebrate a new grant that never happened.

Group equivalent prop appearances under their shared ability. Preserve all variants, search, and customization, but stop presenting cosmetic variety as a long shopping list of distinct prerequisites. Clearly distinguish functional equipment, workflow machinery, and decoration. Replace the universal-looking starter checklist with contextual equipment guidance tied to actual needs.

Highlight affected agents/rooms on selection or placement preview. Keep hover a tiny nameplate; deeper information belongs in click/focus selection. Critical scope must also be readable without color or pointer hover. Explain duplicate usefulness and changes caused by moving/removing an object. Invalid footprint feedback belongs here, after these conceptual fixes.

**Done when:** a user can inspect a prop and correctly explain its purpose, necessity, recipients, and duplication rule without visiting Abilities or a manual. Selecting an existing object and previewing the same object teach identical rules.

## 3. Make the first useful action obvious in the existing station

**Deliverable:** a revised first-use COMMS/coach sequence and cleaner navigation hierarchy.

Start with a task that works under the actual current setup: for example, planning from supplied text or summarizing a pasted note. Offer at most a few understandable starting choices, alongside free-form input. The user can ask for any task. Existing model/provider setup should explain its immediate purpose and resume this same journey when complete.

Replace the general construction-first lesson with a short, skippable sequence tied to real work:

**Ask for something useful → see who is working → open/read the result → optionally customize or repeat it.**

Introduce additional equipment, another agent, or a conveyor only when it helps explain or accomplish the chosen task. For users who choose Build first, explain the selected tool and its effect directly; customization remains immediately available.

Use one contextual COMMS/coach message at a time. Completed or dismissed help stays dismissed; help remains reachable later. Do not add a large permanent guidance panel over the station.

Give the existing categories crisp responsibilities: Tasks tracks work, Deliverables opens produced files/builds, Recipes starts prepared jobs, Automation manages repeated work, Quests tracks meaningful goals/progress, and Commander owns editable knowledge about the user. Link records across these categories with the current context preserved. Remove the My Work menu entry and hub after moving its unique source controls to Commander and relevant start/repeat/result actions to their established surfaces. Existing discovery data and work records survive.

**Done when:** on a fresh configured station, a novice can choose an action, start it, understand its progress, and find the result without being taught the menu hierarchy or placing unnecessary equipment.

## 4. Make setup a continuous part of doing the work

**Deliverable:** three complete journeys using existing controls: missing capability, outside-service connection, and simple conveyor/routine setup.

Use one consistent behavior: detect the specific missing requirement, explain its purpose, open the exact existing control, preserve the task, verify the result, and continue from the same task. A click or saved credential alone never means setup succeeded. Do not invent missing requirements from uncertain model text; ground blockers in actual capability, connection, or execution checks.

For services, lead with the platform and account. Show the easiest supported connection path; manual keys/custom MCP remain available as details. Avoid duplicate top-level service entries for different transports. Show genuine setup limitations and access scope. After connection, return to the original task rather than abandoning the user in settings.

For conveyors, the selected line should visibly read:

**Starts when … → this agent does … → next step … → result appears …**

Keep one selected-line configuration flow for input, step agent/instructions, and result. Use accurate remaining requirements. A stamped layout is configured only after those requirements are met. Clearly separate “Preview routing” from a real sample job. Show why directly messaging an agent does or does not start the full line at the place the user initiates work.

For routines, keep the enabled/disabled state, next run, target, and any missing access beside the save/run controls. Show a plain-language explanation of relevant context differences. Do not make users memorize separate permissions lessons for chat, channels, and schedules.

**Done when:** a novice can recover from one missing dependency and return to the original job with inputs intact; can start a two-step line intentionally; and can correctly predict whether a saved routine will run. Existing working automation and deliberately restricted rooms retain their intended behavior.

## 5. Keep customization deep while reducing default decisions

**Deliverable:** apply one information hierarchy across the existing panels.

The first layer contains purpose, essential inputs, actual status, immediate consequences, and the main action. Expandable details contain exact prompts, IDs, alternate connection methods, model tuning, budgets, routing internals, and uncommon options. Access scope and spending/external-action consequences remain visible when relevant to the decision.

Retain search, keyboard shortcuts, reusable templates, and remembered detail expansion. A user can inspect and override agent-chosen defaults without being forced through advanced settings for every ordinary job. Avoid a separate beginner edition or automatic expertise classification that unpredictably rearranges controls.

Clean up labels that imply the wrong action: execution finished versus needs review; marking a task complete versus publishing; saved versus scheduled; available permission versus connected service. The existing result card should lead to the actual answer/file, with a clear way to revise it or make the work recurring.

This applies established recognition cues and progressive disclosure: make relevant choices visible and defer secondary complexity until wanted. See [Nielsen Norman Group on recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/) and [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

**Done when:** beginners complete the core journeys from the first layer and experienced users can still reach and change the important advanced settings without hunting through new destinations.

## 6. Make the game teach useful work and make personalization useful

**Deliverable:** refine the current station activity, coach, recommendation, and quest behavior. Reuse the existing recommendation arbiter and its single visible message slot.

The repeated experience should be: ask or accept useful work, see its real execution, receive a result, give a correction, and see a better next suggestion. Show spatial cause and effect when it corresponds to real activity. Do not require room expansion or specialist recruitment just to complete a beginner lesson.

When StarNet proposes equipment, recruitment, or a repeatable workflow, explain the concrete benefit from the user's activity. If it has observed repeated weekly report work, it may offer to schedule that report. It must not fabricate repetition or imply ongoing monitoring of accounts the user has not connected.

One relevant suggestion with a reason and a direct action is enough. “Not useful” should help suppress similar suggestions. Use Commander for learned facts, sources, and corrections; show the supporting reason at the suggestion. Reconcile local-storage and model-transmission explanations. Preserve existing pause/forget controls.

Make quests celebrate useful milestones and help the user pursue their actual goal. Keep deeper progression history available without adding more default gauges. Engagement comes from useful results, visible activity, personal ownership, and growing understanding; capability access must not depend on points or a tutorial sequence.

**Done when:** users can explain why a suggestion appeared, act on or dismiss it, and connect visible progress to something accomplished. Expert users can reduce coaching without losing functionality.

## Delivery order and validation

Ship in small reviewable passes, testing the same journeys after each pass:

| Pass | Scope | Exit condition |
|---|---|---|
| A: coherent rules | Step 1; highest-impact prop/room wording and runtime mismatches from step 2 | Effective behavior and explanations agree; no duplicate-kit instructions contradict the intended model. |
| B: understandable station | Remainder of step 2, first-use/navigation from step 3, essential information hierarchy from step 5 | A beginner can start work and explain objects without developer help. |
| C: continuous work | Step 4 and completion/result clarity | Missing setup is resolved in context; workflow, routine, and result paths are completed. |
| D: useful return visits | Step 6 and remaining expert refinements | Suggestions are understandable/useful and customization remains efficient. |

Before code changes, collect a baseline with about five people new to AI harnesses and several experienced users. Use the same natural tasks after the first pass; include fresh participants to avoid confusing learned familiarity with improvement. Do not coach them through the UI. Ask neutral questions such as “What do you expect this to do?” and record hesitation, incorrect predictions, unnecessary actions, help requests, and task completion. The sample is formative evidence, not a statistical guarantee.

Proposed release targets for these journeys, to calibrate against the baseline:

- At least 4 of 5 fresh novice participants complete a first useful task and find its result without facilitator help, within five minutes after provider setup.
- At least 4 of 5 correctly explain whether a selected prop is needed, whether another copy helps, and which agents/rooms it affects.
- At least 4 of 5 complete a simple workflow and correctly distinguish routing preview from real work.
- At least 4 of 5 resolve one missing setup requirement and resume the same task without re-entering their request.
- No observed misunderstanding of access scope, whether a routine is active, or whether an action sends/publishes versus merely marks completion. Any such misunderstanding blocks that journey's sign-off.
- Experienced participants can still change prompts, assignments, connection details, and routine settings; compare time and wrong turns with the baseline.

Record provider/connection setup separately so authentication time does not conceal interface friction. Test fresh and existing stations, solo and multiple rooms, restricted and Full Access modes, direct and scheduled work, disconnected services, and narrow and wide windows. Include keyboard/focus checks; essential relationships cannot depend on color or hover alone.

For implementation, run the repository's required test gates and verify the edited behavior in the live app. Add focused behavior coverage where rules/state transitions change; visual wording changes are reviewed through live journeys. No claim of universal ease of use follows from a green automated suite.

## Preventing the confusion from returning

Add a short comprehension section to the existing change-review process. For each new feature or material change, its author must identify:

1. The user intention and existing category it belongs to.
2. The sentence explaining its purpose.
3. Which rules/requirements a user must understand, and where those are shown at the moment of need.
4. The visible result of the primary action and how to recover or return to the original task.
5. Which controls are essential and which can be expanded.
6. Whether it introduces a new noun, destination, status, or exception; if so, why existing concepts cannot express it.
7. The live journey proving the explanation matches runtime behavior, including a relevant failure path.

Assign one reviewer responsibility for cross-surface consistency for each pass, even when implementation is split across contributors. Keep the behavior contract, canonical terminology, and capability explanations alongside the implementation they describe. Recheck them when runtime behavior changes. Track recurring confusion in the existing QA process and run a small fresh-user check for major changes to these journeys.

The ongoing rule is: each addition must fit the model users already learned, or deliberately update that model everywhere it is taught. Adding another paragraph to the manual is not sufficient evidence that the interface is understandable.

## Existing implementation surfaces to extend

These are starting points, not claims that only these files require changes. Recheck current trunk before implementation.

- Rules and availability: `sidecar/capability/{resolve,office,effective-toolsets}.js`, `sidecar/index.js`, `frontend/app/world.js`, existing execution-profile and permission authorities.
- Station and equipment: `frontend/app/build.js`, `frontend/app/tutorial.js`, `frontend/app/windows/connectors.js`, current selected-object cards and world labels.
- First useful task: `frontend/app/onboarding.js`, `frontend/app/chat.js`, `frontend/app/firstvalue.js`, existing marketplace/recipe launch.
- Category cleanup: current station navigation and `frontend/app/workhub.js`; preserve discovery/source data while relocating unique controls.
- Proactive help: `frontend/app/recommend.js`, `beatcard.js`, current Commander, quest, and recommendation stores. Preserve one evidence-backed voice.

The implementation preserves the runtime and station: read-only equipment explanations, purpose-based prop search, corrected optional tour, existing-category navigation, draft creation in Recipes, sources in Commander, clearer workflow/routine/completion labels and expandable technical details. The duplicate My Work destination is retired. The new behavior contract and PR-review prompts keep these explanations consistent.

This does not constitute sign-off on every exit condition above. Fresh-user sessions remain outstanding. Automatic return from every connector setup, affected-agent canvas highlights and broader quest refinements remain follow-through; this pass reuses the existing supported connection and workflow mechanisms. Matching service names now share one catalog entry with an expandable alternative API connection. Record tested journeys in the implementation receipt rather than treating this plan as proof of completed behavior.
