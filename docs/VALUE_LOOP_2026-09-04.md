# StarNet: the first useful-work loop

Implemented in the isolated `agent/value-loop-0904` integration lane. This delivers the five audit priorities as one usable path. It is not a claim that the full StarNet vision or release certification is complete.

## What changed

| Audit priority | Delivered behavior |
| --- | --- |
| 1. Repair trust | ABILITIES reports effective per-agent access, including Full Access overrides. Completion, adoption, and satisfaction are separate signals. Explicit Keep/approve actions still teach preferences. Host-stamped memory provenance distinguishes inference from user confirmation and labels recall as reference material. |
| 2. First personal value | “Start something useful” offers a client update, meeting actions, message replies, or a custom result. It uses the user's expressed pain when available, asks for one pasted sample or approved folder, and launches through the existing task/run system. The optional tool tour remains available. |
| 3. Unify work | MY WORK joins existing conversations, live channels, discovery findings, and saved outputs. It groups doing/planned, needs-you, and finished work, with result previews, conversation/correction controls, and a recurring-work draft. Advanced controls remain accessible. |
| 4. Non-developer discovery | An explicitly selected approved folder can surface a weekly client-update opportunity from recent Markdown, text, or CSV notes. Suggestions cite filenames, lines, and excerpts. The source is bounded, pausable, removable, persisted, and revalidated before launch. Discovery itself does not call a model. |
| 5. Make benefits visible | The station has a persistent outcome instrument. MY STATION shows the existing verified goal ledger, adaptation receipts, recurring jobs, scheduler state, and latest recorded routine output. Existing physical journey beacons remain authoritative. No completed run is promoted into a goal achievement automatically. |

## Walkthrough

1. Open **WORK → MY WORK → START SOMETHING USEFUL**.
2. Choose a result and paste notes, or select an approved source folder. **Create draft** sends the real request. Missing source input stays on the form with an actionable error.
3. Follow the work in MY WORK. Open its saved file or expand **Objective, result & controls**. **CORRECT THIS** prepares a revision in the existing conversation.
4. Under **FIND WORK**, select an approved folder, save the source, and scan. Review the cited evidence before launching. A failed launch does not consume the suggestion.
5. **MAKE RECURRING** prepares the existing automation form with the task, agent, and folder. It does not create a routine by itself. A pasted sample is explicitly identified as fixed material that must be replaced for fresh recurring updates.
6. **MY STATION** shows what actually ran and what actually changed the station. A paused scheduler has no promised next run; E-STOP, degraded storage, and unconfirmed scheduler health remain visible.

## Live verification

The app ran at `http://127.0.0.1:8964/` against a local deterministic provider and disposable source material. No production model credentials were used.

- Empty source: rejected in the form without launching work.
- Pasted sample: real brief/run/file-write path completed; MY WORK changed from Connecting to completed; the Markdown deliverable opened in its safe preview.
- Folder source: explicitly added the synthetic client-notes folder, opted into discovery, and scanned. The suggestion cited `weekly-notes.md:2: Completed: homepage draft delivered.`
- Real process restart: the source, enabled setting, last-scan timestamp, candidate citation, existing conversation, and saved output survived. The workspace was resumed without reseeding.
- Discovered task: the folder was preselected, evidence was revalidated, a real read/write run completed, and the accepted suggestion left the shelf.
- Recurring result: saved a clearly labeled local verification routine, left scheduling off, ran it once manually, and observed the completed result. MY STATION showed **Scheduler paused · Last run completed**, with the actual recorded output.
- Recurring-session restoration: reloaded the app after the run. Existing sessions healed their underlying run IDs and completion metadata; MY WORK showed one completed item with its output attached and no false unconfirmed item.
- Browser inspection: no warning/error entries were observed during the integrated walkthrough. Window layout, source controls, file preview, and station view were inspected in the running app.
- The trust lane separately exercised effective permissions, override disclosure, revocation, authentication, and persistence against a real seeded sidecar.

The replay proves application wiring, persisted state, and tool execution. It does not evaluate production-model judgment or writing quality.

Full gates on the combined implementation and synchronized provider changes (`63a0ac6a3`): **707/707 fast test steps passed; 92/92 HTTP test steps passed**. The HTTP runner budget increased from ten to fifteen minutes after the expanded suite twice reached its final steps without assertion failures before the old deadline. All test steps and bounded process-tree termination remain enabled. The fail-open ratchet passed with its index baseline lowered; no allowance was raised.

## Boundaries that remain

- Document discovery is a first bounded workflow, not comprehensive observation across a user's accounts and applications.
- Memory risk detection includes heuristic language checks. Reference-only provenance improves the boundary but does not prove universal resistance to prompt injection or every sensitive inference.
- Generic positive feedback is not a goal achievement. Station evolution still requires the existing verified/explicitly confirmed goal authority.
- MY WORK is the simpler entry point; the advanced panels retain their existing concepts and controls. Broader navigation retirement should follow real beginner observation.
- The local browser walkthrough does not certify the packaged desktop build, signed distribution, external integrations, or long-duration production usage.

## Reproduce the local walkthrough

```powershell
node dev/value-loop-replay.mjs --port=8964
```

The helper prints the exact synthetic sample and source folder. To retain state across a restart, stop the helper and restart with the printed scratch directory:

```powershell
node dev/value-loop-replay.mjs --port=8964 --resume=<printed-scratch-directory>
```

The resume path validates the replay workspace before use and does not rematerialize its files. Keep scheduling off in this verification station.
