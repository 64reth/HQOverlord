---
fingerprint: 11341152
slug: connector-buffered-sse-times-out
title: Connector times out waiting for a buffered SSE reply
surface: channels
severity: P1
status: fixed
found: 2026-08-25
lane: reliability-followup
fix: 6adda1348
origin: customer
report: https://github.com/androoAGI/starnet/issues/5
affected: Exact affected build/platform not recorded in sanitized evidence
family: protocol-lifecycle
installer: unverified
recovery: unconfirmed
---

# Connector times out waiting for a buffered SSE reply

## Symptom

Wix tools/list times out even though the SSE stream has delivered a reply.

## Repro

Serve the JSON-RPC result as an SSE frame while keeping the HTTP stream open; wait for tools/list.

## Evidence

docs/EMAIL_BUG_FOLLOWUP_2026-09-04.md; test/mcp.transport.test.js; source fix 6adda1348

## Verdict

Source repair is present. Installer behavior and customer recovery remain unverified; run the customer journey and release checks before changing those outcomes.

## Regression

Before 6adda1348 transport waited for stream closure. The streaming transport regression resolves complete replies while the connection remains open.

## Sibling coverage

{
  "adapters": [
    {"target":"MCP HTTP/SSE","state":"covered","test":"test/mcp.transport.test.js","scenario":"Streaming replies resolve before EOF and 401 propagates auth failure","gate":"fast"},
    {"target":"native LLM protocols","state":"not-applicable","reason":"This defect is in MCP transport rather than an LLM request serializer; provider protocol tests do not prove connector recovery."}
  ],
  "entrypoints": [
    {"target":"connector tool invocation","state":"covered","test":"test/e2e.mcp-connector.test.js","scenario":"MCP discovery and invocation through production sidecar","gate":"http"}
  ],
  "displays": [
    {"target":"connector status UI","state":"covered","test":"test/connectors-ui.test.js","scenario":"Connector state presentation","gate":"fast"},
    {"target":"customer Gmail/Wix authorization","state":"blocked","reason":"Exact customer OAuth scopes and account state have not been tested; require a live connector retest."}
  ],
  "lifecycle": [
    {"target":"session expiry","state":"covered","test":"test/e2e.mcp-session-expiry.test.js","scenario":"Concurrent calls recover through one reinitialization","gate":"http"},
    {"target":"OAuth refresh race","state":"covered","test":"test/connector-oauth-refresh-race.e2e.test.js","scenario":"OAuth refresh respects concurrent credential changes","gate":"http"},
    {"target":"installed desktop restart","state":"blocked","reason":"Physical installed application and OS keychain proof are still required."}
  ]
}
