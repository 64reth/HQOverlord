# HQOverlord Living Station (desktop)

Run from the repository root with the existing Node 24+ installation and dependencies:

```powershell
Set-Location C:\Projects\HQOverlord
node apps/web/src/main.mjs
```

Open http://127.0.0.1:8788. The launcher starts the existing runtime host on port 8789 and serves this desktop UI on 8788. Stop both with Ctrl+C. Stop any older Control Centre instance using port 8788 first. HQ_PORT and HQ_RUNTIME_PORT can select distinct alternative ports.

Paid execution remains explicitly controlled by HQ_ENABLE_MODEL_EXECUTION=1 and existing host provider configuration. Without it COMMS queues jobs and accurately reports that execution is disabled. Credentials never enter the frontend.

## Completed surface

Supplied logo and VT323 typography; extracted floor, wall, bay, Crew, Overlord, Gear, console and machinery artwork; 64x32 isometric view of real agents, desks, placed equipment and workflow facts; selection, camera pan/zoom and arrange-mode bay/Gear dragging with tile snapping. Gear placement calls existing runtime capability operations. Existing COMMS and operator windows expose dossiers, profiles/budgets, notebooks, tools, workflows, recipes, routines, Night Shift, channels, approvals, artifacts/downloads and accounting.

Room identities, desks and Gear assignments are backend-owned. Room geometry and Crew appearances are per-business localStorage preferences in this browser, not host state. Overlord is an appearance assigned to an existing real agent, not an extra invented agent. Activity animation uses only actual working states and admitted work items.

## Frozen unfinished work

Artwork extraction still needs visual refinement: some dark outlines/background remnants and console crops are imperfect. Modular room openings and environmental prop placement are unfinished. Workflow machinery uses a generic machine sprite; type-specific visuals remain unfinished. Desktop drag/drop, room creation, capability changes and restart restoration have not received a complete manual acceptance pass. Appearance/room geometry does not travel between browsers. Paid execution cannot be used until the operator supplies host provider credentials and explicitly enables it. No automated tests were added or run for this UI landing.

## Assets

Original sheets are preserved under public/assets/station. Derived PNGs and manifest are in its derived directory. Reproduce extraction with powershell -ExecutionPolicy Bypass -File apps/web/scripts/prepare-station-assets.ps1. Build with npm.cmd --prefix apps/web run build.
