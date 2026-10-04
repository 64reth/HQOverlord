# StarNet Phase 5 Evidence Template

Create placeholders with:

```powershell
npm.cmd run phase5:evidence:init:decision
```

The usual generated path is:

```powershell
npm.cmd run phase5:workload
npm.cmd run phase5:surface
npm.cmd run phase5:evidence:check
```

`phase5:workload` records the live gamified UI workload and restart soak.
`phase5:surface` records the browser/computer-use contract evidence and desktop build classification.

The final decision is separate. It may be `limited-pilot` while P5 evidence is otherwise green; `ready-to-replace` is only valid when no accepted replacement gaps remain.

```json
{
  "generatedAt": "2026-06-27T00:00:00.000Z",
  "operator": "andro",
  "workloads": {
    "passed": false,
    "proofLevel": "",
    "screenshots": [],
    "runIds": [],
    "transcriptIds": [],
    "artifactPaths": [],
    "ledgerRows": [],
    "modelNames": [],
    "toolCalls": [],
    "notes": ""
  },
  "surface": {
    "browser": {
      "status": "blocked",
      "proofLevel": "",
      "logs": [],
      "notes": ""
    },
    "computer": {
      "status": "blocked",
      "proofLevel": "",
      "logs": [],
      "notes": ""
    }
  },
  "soak": {
    "phase4LiveGreen": false,
    "phase5WorkloadGreen": false,
    "restartPreserved": false,
    "notes": ""
  },
  "recovery": {
    "phase4RecoveryGreen": false,
    "phase5RecoveryGreen": false,
    "notes": ""
  },
  "desktop": {
    "status": "blocked",
    "logs": [],
    "notes": ""
  }
}
```

Decision file:

```json
{
  "decision": "limited-pilot",
  "acceptedBy": "andro",
  "acceptedAt": "2026-06-27T00:00:00.000Z",
  "notes": "P5 evidence is green, but remaining replacement gaps keep this below ready-to-replace.",
  "acceptedReplacementGaps": []
}
```

Allowed decisions:

- `ready-to-replace`
- `limited-pilot`
- `blocked`
- `not-ready`

