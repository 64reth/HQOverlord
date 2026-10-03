# HQOverlord Living Station

Desktop application using the existing authoritative runtime and supplied pixel artwork.

## Launch

From PowerShell with the repository's existing dependencies and Node 24+:

```powershell
Set-Location C:\Projects\HQOverlord
npm.cmd run control-centre
```

Open http://127.0.0.1:8788. Ctrl+C stops the Station and its business runtime hosts. HQ_PORT selects another local port.

A fresh installation opens Overlord selection. Selection creates only the real HQ lead; there is no recruited Crew, user business, bay or workflow. The lead has an internal HQ Station scope, separate from user-created businesses. Create a named business explicitly before recruiting its Crew. Each recruited agent receives a real bay.

Business 001 is optional, never imported by normal HQ startup. Its existing data remains in its own package. Its explicit legacy launcher is npm.cmd run business:001:control-centre.

## Operate

Select the Overlord or Crew to use COMMS and their dossier. The operator dock opens notebooks, models, channels, workflows, recipes, routines, Night Shift, approvals, files/Outbox and costs/budgets. Models accepts host credentials, exact model tariffs and per-job budgets. Multiple provider/model configurations are retained; Crew can select a configured model. Model configuration is not a claimed successful provider call. Without a configured model COMMS can queue work but cannot execute it.

Use the mouse to pan the Station, the wheel or +/- controls to zoom, and FIT to view all rooms. ARRANGE enables dragging bays, Gear and decorations with tile snapping; occupied tiles are refused. Choose Gear or Decor then click a room tile. Gear enables only the runtime's implemented tools for Crew in the same assigned room; decorations grant nothing. Consequential tool operations retain the runtime's exact-operation approval requirements.

ROOMS edits named rooms, tile dimensions and floor materials. Desk, Gear, Crew, workflows, jobs and permissions are existing runtime state. Visual room geometry, appearances and decorations save to the host's Station profile. The selected business is a browser navigation preference. Restart restores both domain records and Station preferences.

## State and assets

HQ data defaults to apps/web/.local, independently of Business 001. HQ_DATA_DIR selects a different application data directory. Credentials stay in the host's ignored data directory or provider environment variables; they are never included in public snapshots.

Original production sheets are preserved under public/assets/station. Derived PNGs and manifest are in derived/. Reproduce extraction with powershell -ExecutionPolicy Bypass -File apps/web/scripts/prepare-station-assets.ps1. Build with npm.cmd run build:web.

## Verification

Manually operated Chrome on desktop: fresh Overlord selection and an empty Station, explicit business creation, recruitment, snapping a real bay, Gear placement and corresponding file capabilities, decoration placement, room creation, workflow saving/rendering, queue/cancel in COMMS, notebook persistence, operator windows and file browsing. Restart restored the selected business, Overlord, Crew, moved desk, Gear, room geometry, decoration, saved workflow and notebook. Build and root typecheck pass. No automated tests were added or run.

Real paid provider execution was not exercised without operator credentials. External channels/connectors need their existing host transport configuration and enable flags.
