# Reconnect recovery and learned website lookups

`agent/hermes-reconnect-capture-0905` fast-forwarded into `feat/harness-backend`
at `9c9f788d0380a3d4f827e4832d24d752d964d7ce` (implementation `deed5ddfb`,
reviewed renderer source lock `9c9f788d0`). No shared event/schema changes.

## Behavior

- SSE transport retains at most 1,024 observations / 2 MiB. Boot-scoped sequence IDs
  recover events missed while disconnected. Expired, invalid, future or old-boot cursors
  trigger snapshot recovery. Renderer commands are excluded from replay.
- The station ignores duplicate events and callbacks from obsolete connections. A
  reconnect stays visibly degraded until authoritative snapshot reconciliation succeeds.
- `browser.network` can derive up to eight GET Fetch/XHR client candidates from observed
  successful requests. It does not execute them or capture headers, cookies or bodies.
  Credential/signed query parameters are excluded. Clients reject redirects, HTTP errors,
  non-JSON output, and responses above 2 MiB, with a 30-second timeout.
- **Learn a Website Lookup** appears in the existing skill library. Its procedure verifies
  the direct response against the page before saving a runtime skill plus its script.

## Evidence

Full gates passed both before integration in the isolated worktree and after integration
in `C:/Users/andro/Desktop/gen`, on the exact same committed candidate:

```text
run-fast-tests: OK — 712 step(s) green
run-test-list: OK — 95 step(s) green
```

Post-merge command exits were both 0. Logs remain in the isolated worktree at
`dev/hermes-trunk-fast.log` and `dev/hermes-trunk-http.log`; the live receipt is
`dev/hermes-proof.json`. Later changes in this lane are verification documentation only.

Focused checks also passed after integration:

```text
channels.sse: OK (80 assertions)
channels.replay: offline replay, expiry, restart, duplicate cursor, byte bounds,
                 command exclusion, dead socket passed
browser-workflow: observed GET derivation and real HTTP execution/error checks passed
```

The HTTP replay test creates real channel events while disconnected, receives them after
reconnect, confirms the next reconnect does not repeat them, restarts the real sidecar,
and confirms that the old cursor requires reset.

Live source-app verification used `node dev/seed.js --keep` in the isolated worktree
on port 8897, plus real headless Chromium/CDP. Observed state:

```json
{
  "initial": { "down": false, "paused": false, "bridged": true },
  "libraryVisible": true,
  "procedureVisible": true,
  "afterSidecarStopped": { "down": true, "paused": false, "bridged": true },
  "afterSidecarRestarted": { "down": false, "paused": false, "bridged": true },
  "restartHandshake": { "reset": true },
  "capture": {
    "observedRequests": 3,
    "candidates": 1,
    "directResult": { "count": 2, "items": ["one", "two"] },
    "matchedRenderedPage": true
  }
}
```

The generated client was saved via the production `skill.manage` tool and package store;
a separate Node process read back the exact support-file source. The library procedure
was opened in the running station and its text was present in the DOM.

## Sweep and limits

The sweep covered replay count/byte eviction, restart identity, duplicate delivery,
obsolete connection callbacks, renderer-command exclusion, failed replay writes, generated
client error paths, durable skill files, and the identical website renderer mirror. Claims
source hashes were refreshed after review without changing any claim verdicts.

This is verification of the source app, not a rebuilt installed desktop binary or a
station-wide readiness verdict. Website capture covers read-only JSON lookups; authenticated
and mutating workflow replay is outside this slice. The seed server stopped after proof.
Automatic approval review blocked removal of the temporary browser profiles, so they remain
only in the isolated worktree and are not committed. The integration tree's pre-existing
`qa/STATUS.md` edit was preserved; this separate digest avoids overwriting that owner's work.
