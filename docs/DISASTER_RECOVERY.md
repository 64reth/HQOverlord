# Complete station disaster recovery

StarNet's complete-station recovery bundle is an offline, verified recovery point. It is different from the in-app station-configuration export: it captures every non-ephemeral file under `WORKSPACES`, plus an optional browser-state export, and verifies every payload before it changes a destination.

## What it preserves

The bundle must contain evidence for all of these categories before the recovery CLI will write it: agents, rooms and props, conversations, memories, routines, loops, tasks, projects, deliverables, permissions, and connector references.

Credentials and machine authority are deliberately not portable. The bundle preserves connector/channel identities and project references, while excluding provider credentials, OAuth grants, channel tokens, service keys, browser credentials, browser cookies, and absolute-path authorization. `backup`, `inspect`, and `restore` print exact `restored`, `skipped`, and `reauthentication` arrays.

## Create a recovery point

1. On StarNet's RESUME/reconnect screen, choose **EXPORT AGENT** to download the browser-owned `starnet.*` state. Keep this file beside the station recovery bundle. This step is optional only when browser-local state is not needed; the durable sidecar save is still captured from `WORKSPACES`.
2. Quit StarNet completely. On the desktop build, confirm the tray process has exited. Do not capture while the sidecar is accepting mutations.
3. Locate the active `WORKSPACES` directory. A source/dev launch defaults to `%LOCALAPPDATA%\StarNet\workspaces` on Windows and `$XDG_DATA_HOME/StarNet/workspaces` (or `~/.local/share/StarNet/workspaces`) on other sidecar platforms. A packaged desktop launch prints the exact path on its `startup ... workspaces=...` diagnostic line. A legacy install may still use its existing `Skynet/workspaces` directory in place.
4. From a StarNet source checkout, create and inspect the bundle:

```powershell
npm run recovery:backup -- --workspace "C:\path\to\workspaces" --output "D:\Backups\station.starnet-recovery.json" --browser-state "D:\Backups\starnet-agent.json" --app-version "0.8.5" --mutation "operator-2026-08-04T09:20Z"
npm run recovery:inspect -- --bundle "D:\Backups\station.starnet-recovery.json"
```

Only an `ok: true` result is a recovery point. Copy the bundle to storage that is not on the station's disk.

## Restore onto a clean machine or profile

1. Install the same or a newer compatible StarNet build, launch it once, and then quit it completely.
2. Choose a new, nonexistent `WORKSPACES` target. Restore will refuse a non-clean target unless rollback mode is explicitly requested.
3. Restore and generate the browser import:

```powershell
npm run recovery:restore -- --bundle "D:\Backups\station.starnet-recovery.json" --target "C:\Users\new-user\AppData\Local\StarNet\workspaces" --browser-output "D:\Backups\starnet-browser-restore.json"
```

4. Point StarNet at the restored `WORKSPACES` directory and launch it. If browser-owned records were captured, choose **RESTORE BACKUP** and import `starnet-browser-restore.json`.
5. Work through every row in `receipt.reauthentication`: sign back into providers/connectors/channels, re-enter service keys, and reauthorize or relocate project folders. A restored project reference is shown as revoked until that authorization succeeds.

## Roll back to a previous station version

Stop StarNet, then restore the older verified bundle with `--replace-existing`:

```powershell
npm run recovery:restore -- --bundle "D:\Backups\station-previous.starnet-recovery.json" --target "C:\Users\me\AppData\Local\StarNet\workspaces" --replace-existing
```

The replaced directory is retained beside the target as `workspaces.rollback-<recovery-point>`. Restore stages and verifies the incoming generation before activation; if activation fails, it moves the old generation back.

## Recovery-point objective

A successful stopped/quiescent snapshot guarantees zero completed mutations lost through its barrier. The rehearsal then applies exactly one completed mutation after that barrier, damages the station, and measures exactly one lost mutation after restore. This demonstrates the requested one-mutation objective for explicit snapshots.

StarNet does not yet claim an automatic continuous-backup RPO. Mutations completed after the latest explicit recovery point remain at risk until another recovery point is created.

## Run the destructive rehearsal

```powershell
npm run recovery:rehearsal
```

The rehearsal uses disposable profiles and covers a clean-profile restore, corrupt bundle, interrupted backup, missing required store, disk-full failure, previous-version rollback, and the measured recovery point. It writes the latest machine-readable inventory and human summary under `.dogfood/disaster-recovery-latest/`.
