# StarNet: five security and durability defects fixed on 2026-09-04

Originally reproduced against trunk `31a7368d897cabf809795b46e667cf67a1f5559a`. The fixes were implemented on `agent/bug-security-audit-0904`, synced through trunk `c0a2ca521c51d14c0c57c275336602975854b81a`, and verified in the running seeded app. These were the highest-impact findings confirmed in this pass, not an exhaustive security certification.

## 1. P1 — Imported connector endpoints inherit existing credentials

**Source:** `sidecar/index.js:10013–10023`; ordinary connector editing also retains a previous token at `10476` without binding it to the previous endpoint.

Import looks up an existing connector by id, accepts the imported URL, then copies the existing token and secret headers into that new configuration. It does not require the endpoint to match. An attacker-supplied station backup matching a known connector id can redirect that connector's credentials after the user imports it and reloads the connector (or restarts the app).

**Live proof:** configured a local mock MCP server with fake bearer `AUDIT_FAKE_BEARER` and header `AUDIT_FAKE_HEADER`. Imported a new URL for the same id without including any credentials. Import returned `ok:true`, `secretsNeeded:[]`. After `/api/connectors/refresh`, the replacement server received BOTH saved secrets on three handshake requests.

**Fixed:** connector credentials and OAuth grants are retained only when the transport and exact HTTP endpoint still match. Import and ordinary edit paths now clear inherited credentials when the service identity changes, persist the combined connector/OAuth state before adopting it, and reconcile the live manager after import.

## 2. P1 — MCP redirects forward custom authentication headers across origins

**Source:** `sidecar/mcp/transport.http.js:111`.

The transport validates only the initial URL, then uses fetch's automatic redirects. Custom authentication headers such as `X-Api-Key` survive a cross-origin redirect. A configured server with an unsafe redirect can disclose keys to a different origin. The initial URL's HTTPS policy does not validate subsequent destinations.

**Live proof:** a local MCP endpoint returned HTTP 307 to another port (a different origin). The second server received `X-Api-Key: AUDIT_REDIRECT_HEADER` on all three handshake requests, and StarNet reported the connector connected. This proves cross-origin custom-header disclosure; a public HTTPS-to-HTTP downgrade was not exercised. This is not a claim that standard Authorization headers survive cross-origin fetch redirects.

**Fixed:** MCP POST and session DELETE requests use manual redirect handling. Every 3xx is refused before a second request or redirect-supplied session id can be accepted, and the client returns a bounded actionable error.

## 3. P1 — “Secrets excluded” station backups contain plaintext connector secrets

**Source:** `sidecar/configexport.js:47–58,83`; user-facing claim at `frontend/app/stationui.js:5529`.

Export copies stdio arguments verbatim and treats environment variables as non-secret unless their names match a regex. Credentials passed as command-line arguments therefore leak, including an explicitly named `--api-token`. Environment values with names outside the regex also leak. The normal connector status endpoint already redacts these same fields.

**Live proof:** saved a disabled stdio connector with argument `--api-token=AUDIT_ARG_SECRET` and environment `ACCESS=AUDIT_ENV_SECRET`. `/api/config/export` returned both values verbatim, with `configured:false` and `redactedFields:[]`. No subprocess was executed. The Settings export handler downloads this envelope and displays “secrets excluded.”

**Fixed:** portable exports omit every connector header and environment value, scrub secret-shaped arguments and URL arguments, and retain field-name-only re-entry markers. The exported payload now matches the UI's “secrets excluded” claim for the reproduced cases.

## 4. P2 — Backup round trips enable disabled connectors and erase OAuth mode

**Source:** connector shapes in `sidecar/configexport.js:77–93,172–183`; wholesale replacement in `sidecar/index.js:10017–10022`; enabled default in `sidecar/mcp/manager.js:360`.

The backup schema omits `enabled`, `oauth`, `agentId`, and `cwd`. Import replaces the existing connector with this reduced configuration, preserving selected secrets but losing operational metadata. Thus restoring a backup can activate an intentionally disabled connector and remove custom OAuth sign-in capability. Safe Cell owner and working-directory loss are visible in the serialized shape; their post-restart execution consequences were not separately tested.

**Live proof:** exported and immediately reimported a disabled HTTP connector and disabled custom OAuth connector. Refreshing the HTTP connector changed `enabled:false/state:down` to `enabled:true/state:up`. OAuth start for the formerly OAuth connector returned HTTP 400: `this connector does not use OAuth`.

**Fixed:** backups round-trip `enabled`, `oauth`, `agentId`, `cwd`, and `label`. Legacy backups preserve absence so the live importer can retain compatible existing state or default a replacement connector to disabled. Import updates the live manager after durable persistence.

## 5. P2 — Permission reset reports success after a failed write; grants return on restart

**Source:** `sidecar/index.js:10062–10066`.

Reset clears live grants before attempting persistence and catches the write error without reporting it. A locked permissions file therefore produces a false successful revocation. The dedicated individual-revoke route already handles persistence failure more honestly.

**Live proof:** granted `cabinet:write`, held the scratch permissions file open with Windows FileShare.Read (allow reads, deny replacement), and called `/api/config/reset` for permissions. Response: `{ok:true,section:"permissions"}`; live grants: `[]`; disk grants: `["cabinet:write"]`. Released the lock and restarted the same seeded sidecar with `--keep`. `/api/permissions` again returned `cabinet:write`. Cleaned up using the working individual-revoke route.

**Fixed:** reset persists the empty allowlist first and clears live authority only after the write succeeds. A failed write returns HTTP 500 and leaves the existing live grant visible; a successful reset remains revoked after restart.

## Evidence and limits

- Reproduction script: `dev/audit-security-0904.cjs` (expects the isolated seeded sidecar on port 18964).
- `npm run test:fast`: PASS, 707 steps on the exact verified tree.
- `npm run test:http`: PASS, 93 steps on the exact verified tree.
- `test/configexport.test.js`: PASS, 64 assertions.
- `test/mcp.transport.test.js`: PASS, 100 assertions.
- `test/connector-security.e2e.test.js`: PASS, 19 assertions in a real sidecar with loopback MCP servers.
- `test/config-permissions-import.e2e.test.js`: PASS, including reset and restart persistence.
- Used a disposable worktree, seeded workspace, local mock servers, and fake credentials. No real service credentials or paid model calls were used. Mock connectors and the test permission were removed afterward.
- Final seeded-app verdicts were all true: endpoint replacement blocked credential reuse, redirects reached no destination, exported secrets were absent, disabled state survived, and OAuth mode survived. The permission reset write-failure behavior and restart durability were also live-proven.
- The packaged executable and Settings UI download flow were not exercised; the running app API and downloaded envelope producer were exercised directly.
