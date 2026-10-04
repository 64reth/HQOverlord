---
fingerprint: 9dc98fa0
slug: connector-401-still-shows-up
title: Connector stays up after an authenticated tool returns 401
surface: channels
severity: P1
status: fixed
found: 2026-08-25
lane: reliability-followup
fix: 6adda1348
origin: customer
report: https://github.com/androoAGI/starnet/issues/5
affected: Exact affected build/platform not recorded in sanitized evidence
family: recovery-truth
installer: unverified
recovery: unconfirmed
---

# Connector stays up after an authenticated tool returns 401

## Symptom

Gmail connector appears up while calls require reauthentication.

## Repro

Connect an MCP server successfully, then return HTTP 401 from a tool request; inspect the resulting connector state.

## Evidence

docs/EMAIL_BUG_FOLLOWUP_2026-09-04.md; test/mcp.transport.test.js; source fix 6adda1348

## Verdict

Source repair is present. Installer behavior and customer recovery remain unverified; run the customer journey and release checks before changing those outcomes.

## Regression

Before 6adda1348 transport/auth state retained a misleading connected result. The transport regression surfaces 401 as reauthentication required; live customer Gmail authorization is still unverified.

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
