# Skill Events Contract Request

The `cortex-memory` workstream owns `shared/events.js` and `shared/schema.js`.
This branch does not edit those files directly. To complete first-class skill
telemetry, please add these events additively:

| Event | Required | Optional | Purpose |
| --- | --- | --- | --- |
| `skill.created` | `agentId`, `runId`, `id`, `name` | `createdBy`, `sourceRunId` | A runtime skill package was created. |
| `skill.updated` | `agentId`, `runId`, `id`, `name`, `action` | `path`, `createdBy` | A skill was edited, patched, pinned, restored, archived, or had a support file changed. |
| `skill.viewed` | `agentId`, `runId`, `id`, `name` | `source` | A skill body was loaded through `skill.view` or explicit preload. |
| `skill.used` | `agentId`, `runId`, `id`, `name` | `source` | A skill appeared in the prompt index or was otherwise counted as used. |
| `skill.reviewed` | `agentId`, `runId`, `reviewRunId` | `created`, `updated`, `archived` | Background skill review completed. |
| `skill.curated` | `agentId`, `runId`, `curatorRunId` | `stale`, `archived`, `consolidated` | Curator maintenance completed. |
| `skill.guard` | `agentId`, `id`, `name`, `verdict` | `action`, `findings` | Guard scanner verdict for generated/imported skill content. |

Until this is accepted, StarNet uses the existing `deliverable` event with
`kind: "skill"` plus current memory feedback events for user-approved reflection
turn-in quality.
