# StarNet Phase 4 Attended Evidence Template

The easiest path is to create the placeholders with the helper:

```powershell
npm.cmd run phase4:evidence:init:decision
```

Then fill or generate the evidence after the live UI cutover trial has been run and
check it with:

```powershell
npm.cmd run phase4:evidence:check
```

The init helper never marks pass fields automatically. The usual generated path is:

```powershell
npm.cmd run phase4:ui-proof
npm.cmd run phase4:recovery
```

`phase4:ui-proof` records the live gamified UI cutover and restart soak.
`phase4:recovery` records the automated recovery proof logs for cancel, budget,
denied consent, tool error, and checkpoint/restore. The Phase 4 runner treats
`.dogfood/phase4-attended-evidence.json` as the evidence packet and the notes/log
fields should make clear which pieces were UI-attended and which were automated.

```json
{
  "generatedAt": "2026-06-26T00:00:00.000Z",
  "operator": "andro",
  "sameWorkTrial": {
    "passed": false,
    "screenshots": [],
    "runIds": [],
    "transcriptIds": [],
    "artifactPaths": [],
    "ledgerRows": [],
    "notes": ""
  },
  "soak": {
    "freshPass": false,
    "restartPass": false,
    "transcriptPreserved": false,
    "ledgerPreserved": false,
    "artifactsPreserved": false,
    "memoryPreserved": false,
    "stationStatePreserved": false,
    "notes": ""
  },
  "failureRecovery": {
    "cancelPassed": false,
    "budgetPassed": false,
    "deniedConsentPassed": false,
    "toolErrorPassed": false,
    "checkpointRestorePassed": false,
    "notes": ""
  }
}
```

Final go/no-go is recorded separately in `.dogfood/phase4-decision.json`:

```json
{
  "decision": "ready-to-replace",
  "acceptedBy": "andro",
  "acceptedAt": "2026-06-26T00:00:00.000Z",
  "notes": "StarNet is approved as the main harness.",
  "acceptedPilotGaps": []
}
```

Allowed `decision` values:

- `ready-to-replace`
- `limited-pilot`
- `blocked`
- `not-ready`
