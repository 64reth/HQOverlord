# StarNet: whole-product friction audit and implemented improvements

Baseline: `292dc7b41`. Scope: starting work, setup excursions, service connections, agent access, visual workflows, results, recurring work, navigation, and learning. Source-grounded audit plus live checks of the changed journeys; this is not an observed study of independent beginners or installed-desktop certification.

## Product standard

Users should describe outcomes, recognize what the station is doing, and recover without reconstructing context. The same workflow must support a simple explanation and detailed customization. Existing authentication, task execution, compiled conveyor routes, and configuration panels remain the authorities. Opening a guide does not grant access or launch work.

## Implemented

| Friction | Change | Authority / implementation |
| --- | --- | --- |
| Main start action required notes or a folder even for unrelated tasks | General task entry accepts the user's request without a template or source requirement; source-based drafting remains available | `workhub.js`; existing `App.launchRecipe` task creation/send path; direct requests do not count as template adoption |
| Users need product vocabulary to locate controls | Searchable intent directory for connections, schedules, goals, conveyors, agents, permissions, messaging, profile, outputs, models, and help | Existing window/section destinations; no duplicate settings store |
| Work results and interventions buried in an expanded details section | Visible Read result, View progress, or Review & resolve action | Existing work classification and original conversation |
| Leaving a draft for setup loses entered material | Preserve request, source mode, sample, folder and finding provenance in page memory; explicit clear and successful launch remove it | `FirstValue`; fresh permission and suggestion validation still run before submission |
| Saved service configuration mistaken for a connection; disabled ADDED button prevents recovery | Manage Service routes to the actual saved service; Your Services describes saved setups; next-action hints distinguish disabled/error/auth/connected | Existing connector status and management controls |
| Catalog conflates browser sign-in and manual integration setup | Separate Sign In and Manual Setup labels/filtering; retain API-key and advanced custom setup | Existing catalog capability metadata; no invented OAuth support |
| Conveyor mechanics scattered across objects | Overview presents actual compiled agent steps, saved instructions, onward routes and output connection; click a step to edit | Existing compiled plan, station props and editor |
| Advanced configuration competes with first-use explanation | Conveyor budget controls in an expandable section | Same controls, no capability locks |

## Live evidence

- Root seeded/replay server `127.0.0.1:8974`: blank task rejected without creating work; request survives a visit to Find a control; search for permissions isolates agent access; source-free request goes through Connecting to completed work and exposes Read result. The deterministic replay returns a fixture response: this verifies dispatch and lifecycle, not model output quality.
- Same server: typed a custom objective and synthetic notes, selected folder mode, opened Manage approved folders, reopened My Work. Objective, folder mode, and sample were retained; the form displayed its restoration notice.
- Connector lane `127.0.0.1:8976`: saved disabled DeepWiki fixture appears in Your Services; Manage Service opens its actual row and recovery controls. Manual Setup shows Etsy's actual limitation. No real-account login or new permission grant was used.
- Conveyor lane `127.0.0.1:8982`: placed Front Desk template, viewed unassigned/unknown route, assigned NOVA and saved instructions through the overview's existing editor. Compiled summary became Inbox → 1 step → Outbox; reload retained it; advanced settings remained available. This verifies configuration, not execution of that line.
- Focused regressions cover direct-task versus template attribution, busy-launch no-op, draft cleanup/provenance, connector management/readback, conveyor overview/stacking, run/sample gates and themed controls.

Unsent drafts intentionally stay only in page memory and are cleared by app reload. Existing station state still persists through the normal stores. No backend permission, credential storage, schema, or external-service authentication implementation changed in this pass.

## Remaining priorities, in order

1. **A common connection lifecycle.** Familiar sign-in where actually supported, required access explained in task context, durable connection testing, and consistent reconnect routes. Some providers still require app registration or manual setup; frontend labels cannot eliminate those integration requirements. Extend the existing catalog/OAuth machinery rather than add a second integration system.
2. **Reviewed conversion from successful work to automation.** Current Make Recurring copies the first user request; later corrections can be lost. Prepare an editable reusable brief that incorporates confirmed amendments and distinguishes fixed examples from fresh sources before saving.
3. **Context-preserving links and recovery.** Some output/job/goal links still open a generic library. Carry the selected item through to its existing view. Expose the existing approval/retry/reconnect action appropriate to an interruption; avoid a new competing error taxonomy.
4. **Describe, inspect, then customize a workflow.** Templates and guided routine/loop creation already exist. Natural-language conveyor construction and source-specific trigger visibility remain incomplete. The new graph overview is a readable foundation, not an automatic workflow designer or complete rendering of junction conditions.
5. **Consistent navigation language.** The intent directory reduces vocabulary hunting, but Tasks, Deliverables, Automation, Quests, Abilities and Channels remain separate expert surfaces. Gradually use the same action names and contextual navigation across them, preserving deep links.
6. **Inspectable user understanding.** The profile and local-document discovery remain narrow relative to the thesis. Evidence, uncertainty, corrections, source controls, and useful/irrelevant feedback need one coherent user-facing loop.
7. **Observed beginner validation.** Have unfamiliar users connect a service, request a result, explain a conveyor, change it, recover from a failure, and make useful work recur. Record completion without assistance, wrong turns, lost context, and whether they can explain what will happen next. Do not treat test passes as proof of beginner comprehension.

## Completion criteria for the next product milestone

A user can bring a real problem, connect the required source, inspect a proposed approach, obtain a useful result, make it recur, and confidently change or stop it. Every handoff preserves context. Station activity maps to actual work. Progress celebrates accepted outcomes without locking tools or fabricating benefit.

## Historical integration receipt
2026-09-04 merge digest: agent/seamless-0904 -> trunk 4194a0b54 (exact fast-forward). Whole-product friction audit plus general task entry, intent-based control directory, visible result/recovery actions, in-memory draft continuity, actionable service setup/recovery, and compiled conveyor overview. Candidate and exact postmerge test:fast 710/710 GREEN. Live seeded UI verified task lifecycle, control search/routing, draft setup return/clear, saved connector management, and conveyor assignment/instructions/reload; synthetic/local replay, no production OAuth or installed desktop certification. No backend/route changes; HTTP gate not required for this frontend-only delta. Audit: docs/SEAMLESS_UX_2026-09-04.md. Digest remains isolated because trunk QA file has foreign uncommitted content.
