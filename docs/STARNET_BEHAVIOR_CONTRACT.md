# StarNet: what the interface must explain

The station is home. A user asks an agent for useful work in COMMS, reviews the answer or produced file, and can then customize how that work happens. Building equipment or a conveyor is not a prerequisite for asking a question. Preserve the existing categories and the full customization controls.

| Existing concept | Explain it in one sentence | Show at the decision |
| --- | --- | --- |
| Agent | The AI worker doing this task. | Name, current activity, configured access and model. |
| Equipment prop | Provides an ability such as reading files. | Purpose, current access, equipment scope, equivalent appearances. |
| Decoration | Changes the station's appearance. | Explicitly say it does not add tools. |
| Room | Organizes the station and can define equipment scope for an assigned workflow agent. | The scope rules below; never imply every agent needs a complete kit. |
| Conveyor line | Passes a job through configured agent steps. | What starts it, who does each step, instructions, destination. |
| Recipe | Starts a prepared task with your inputs. | Inputs, expected result, launch action; exact prompt remains inspectable. |
| Skill | Reusable instructions for an agent. | Purpose and any required tools; instructions alone do not connect a service. |
| Routine | Repeats a task on a schedule. | Target, schedule, enabled state and where to review the result. |
| Connection | Gives the agent access to an outside service. | Service/account, actual connection state and access; saved credentials alone are not proof of readiness. |

## Equipment rules: use runtime authority

`WorldModel.agentRoomId` determines equipment scope for bay-assigned agents: an owned desk's room takes precedence; without that desk, the owned bay's room is used. Without an owned bay it returns no room restriction. `bayObjects` projects that room's equipment. `World.heroCaps` follows this projection for the selected agent; `stationCaps` is the broader station/skill view and must not be substituted in an agent access explanation.

- One matching non-compute ability prop in the relevant scope suffices. A cabinet, safe and vault with the FILES badge are alternative appearances, not three prerequisites.
- Agents using the same equipment room share its equipment. Each workflow agent needs an assigned desk (the runtime retains its legacy single-agent/unassigned-desk compatibility).
- A desk in another room can change the equipment scope even when the bay is elsewhere. Do not describe the bay room as an unconditional scope.
- An unassigned lead can draw on station equipment. Delegated/headless contexts have their own runtime projections; do not turn that into a blanket claim that every specialist receives every station prop.
- Full Access or an execution profile can provide tools without equipment. `/api/toolsets` reports effective grant provenance. It does **not** prove an outside service is connected or a particular task is authorized.
- A disabled toolset is fixed in Abilities, not by adding another copy. Full Access overrides are reported by the existing authority.
- Moving/removing the last matching prop changes equipment in the affected room. Tools independently supplied by access settings may remain available. A connection portal may represent a different service, so portals are not interchangeable solely because they share a category.

`frontend/app/equipmenthelp.js` is read-only presentation over these authorities. It must not become another permission engine. This delivery changes no grants, execution profiles, room restrictions, schema, or saved station geometry.

## Execution contexts and evidence

| Context | Rule | Evidence / verification boundary |
| --- | --- | --- |
| Direct chat, no assigned bay | Existing station equipment plus runtime profile/authority. | Existing model/authority tests; live Full Access fixture shows FILES already available with zero cabinets. |
| Workflow agent with bay, no desk | Bay room is the equipment source; the workflow still needs a usable assigned workstation. | `agentRoomId`, `bayObjects`, existing workstation/workflow tests. |
| Workflow agent with bay and desk elsewhere | Desk room wins; a prop next to the remote bay is not implicitly available. | `effective-toolsets.test.js` uses a real two-room model to assert this. |
| Multiple agents in one equipment room | Share non-compute equipment; retain individual desk assignments. | World model implementation and existing desk tests; not independently live-tested with multiple humans. |
| Full Access | Authority may already supply tools even when no prop is placed. | Existing override tests and live preview. |
| Execution profile | The profile can supply its listed objects without props. | Existing effective-toolsets tests cover safe-cell, remote-ssh, trusted-project, this-computer. |
| Delegated / headless work | Existing parent/context projections apply; never infer access solely from the room illustration. | Source trace through office/context resolution; no new grant behavior introduced. |
| Scheduled work | Existing routine target/access settings apply; saved does not imply scheduling enabled. | Existing scheduler tests; live Create Routine shows actual scheduler state. |
| Authority unavailable | Display inability to check, not a positive readiness claim. | Explanation test and explicit asynchronous error handling. |

## Flow and status vocabulary

Normal COMMS work answers in that conversation. A conveyor runs when work reaches its configured intake or trigger; directly messaging a step agent does not inherently launch the whole line. PREVIEW illustrates routing without running an AI job. RUN A SAMPLE JOB uses the real execution path.

Execution finished means **review the result**. MARK COMPLETE records the user's task status; it does not publish or send anything. REPEAT opens the existing routine form with task context; it does not create or enable a routine. Routines saved with scheduling off do not run automatically.

Keep source controls with Commander, prepared work in Recipes, task tracking in Tasks, files in Deliverables, and repeating work in Automation. A user returning from setup must retain the draft. Source-backed suggestions must show evidence, a review action and dismissal, plus truthful local/model-transmission information.

## Change review

For any new user-facing behavior, identify its intention, existing category, one-sentence purpose, requirements, actual state, primary result and recovery. Put secondary controls in expandable details without removing them. Justify new nouns or destinations. Verify the same story in the palette, selection, coach, setup and result. The pull-request template prompts this review.

Automated checks and an expert walkthrough do not prove beginner comprehension. The fresh-user study and targets in `STARNET_CLARITY_PLAN_2026-09-04.md` remain the outcome validation for this work.
