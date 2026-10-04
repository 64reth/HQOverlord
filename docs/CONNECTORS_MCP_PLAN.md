# Connectors — generic MCP bridge

**Branch:** `agent/mcp-bridge` · **Status:** Slice 1 (protocol layer) landed; wiring + UI ahead.

## Goal

Give the harness's agents **connectors**: the ability to reach external tools/services the way
Claude/Anthropic "Custom Connectors" do — via the **Model Context Protocol (MCP)**. One generic
MCP-client integration unlocks the whole ecosystem (GitHub, Slack, Notion, filesystem, Postgres,
…) instead of N bespoke service tools. MCP is **model-agnostic**, so it works over OpenRouter
regardless of the Anthropic API ban — the protocol is about tools, not the model endpoint.

## Why it fits this codebase (it's almost entirely additive)

The harness was built for this. Its spine is **"object = capability made real"**
(`sidecar/capability/registry.js`): placing a room object grants a capability (computer = compute
gate, dish = web, cabinet = files, notebook = memory). A connector is just **another object type**
whose presence grants its tools.

Three facts make the bridge additive:

1. **Tools register fresh per run** in `runOnce` (`sidecar/index.js`) — so per-run MCP tool
   registration is natural; no global toolset policy to fight.
2. **The dispatch boundary is uniform** (`sidecar/tools/registry.js`): capability gate →
   schema-validate → consent gate → timeout → run. An MCP tool that conforms to the tool-def
   shape gets the same enforcement as `fs.write` — including the live consent prompt.
3. **Every dispatched tool already emits `agent.tool_call` / `agent.tool_result`**
   (`sidecar/loop.js`). MCP calls surface on the bus and in the world FOR FREE — **no
   owner-gated `shared/events.js` change needed** for the MVP.

## Key design decisions

- **Transport: remote MCP first (Streamable HTTP + SSE), stdio in Phase 2.** Remote matches
  "Custom Connectors", is fetch-only (zero-dep, Node 18+, the repo ethos), and needs no
  subprocess jail. stdio (the big local-server ecosystem) requires `child_process` spawning +
  Windows Job-Object/AppContainer jailing — the SAME machinery the planned `terminal`/`shell.exec`
  capability needs, so the two should land together later.
- **Dynamic capability resolution.** `CAP_REGISTRY` is static (objectType → grant[]) but MCP tools
  are discovered at runtime. The capability gate is exact-match on tool NAME
  (`resolved.tools.indexOf(name)`), so discovered MCP tool names must be **unioned into
  `resolved.tools`** at resolve time when the agent's room contains a connector object. A static
  `connector` entry in `CAP_REGISTRY` marks the object; the manager injects the dynamic grants.
- **Naming.** `mcp__<connectorId>__<tool>`, sanitized to `^[A-Za-z0-9_-]{1,64}$` (already wire-safe;
  no dotted-name translation needed). Namespacing prevents collisions with built-ins and across
  connectors.
- **Consent posture.** The Commander placing + configuring a connector is itself consent to that
  integration. So: read-only tools (`annotations.readOnlyHint`) auto-allow like `web_search`;
  every other MCP tool is treated as mutating/execute and routed through the consent broker.
  `surface:'autonomous'` (e.g. a Telegram run) default-denies ungranted MCP mutations.
- **Secrets** (server URL, bearer/OAuth token) live in a PROTECTED sibling file under
  `sidecar/workspaces/connectors/` — outside the fs jail, never on the bus, never returned by a
  status route — exactly like the Telegram channel secrets.

## Build slices

- [x] **Slice 1 — protocol layer (pure, host-free, tested).** `sidecar/mcp/client.js` (JSON-RPC 2.0
  client over an injected transport: initialize/listTools/callTool/notify + id correlation,
  pagination, timeout, close) and `sidecar/mcp/translate.js` (MCP tool → registry tool def).
  `test/mcp.client.test.js` covers handshake, pagination, errors, translation, and end-to-end
  dispatch through the real registry. Deterministic (counter ids, injected time).
- [x] **Slice 2 — HTTP/SSE transport.** `sidecar/mcp/transport.http.js`: Streamable-HTTP + SSE over
  injected `fetch`, bearer auth, session-id capture/echo, http-only-for-localhost guard (so the
  token is never sent cleartext to a remote host), bounded by timeout. `test/mcp.transport.test.js`.
- [x] **Slice 3 — connector manager.** `sidecar/mcp/manager.js`: host singleton (like `telegram`/
  `router`) holding connector configs, keeping a client warm per connector, caching `tools/list`,
  exposing `toolDefsFor(id)` + per-agent `toolDefsForObjects(roomObjects)` + `call(...)`. Tokens
  never appear in summaries. Same test file.
- [x] **Slice 4 — wiring.** `index.js`: a manager singleton (`makeHttpTransport`), connector configs
  persisted to the protected `workspaces/connectors/connectors.json`; in `runOnce`, MCP tool defs for
  the agent's room connector objects are registered + unioned into `resolved.tools`/`networkCaps`/
  `approvalRules`; the single-agent browser office auto-includes every configured connector (one agent
  = per-agent). `CAP_REGISTRY.connector` marker entry. `/api/connectors` (GET list, POST upsert,
  POST remove, POST refresh) — tokens accepted + persisted server-side, never echoed back. Boot
  warming. Verified by a live boot-smoke (routes + token-never-leaks + persistence).
- [x] **Slice 5a — Connectors panel.** `stationui.js` `buildConnectors` + a `data-term="connectors"`
  toolbar button + `app.css` styles: add / enable / disable / remove / refresh MCP servers, see each
  server's discovered tools, live over `/api/connectors`. The token field is never re-displayed.
  Browser-verified (panel renders every state, zero console errors; live API round-trip confirmed
  separately via the boot-smoke).
- [x] **Slice 5b — connector-portal prop (the gamified projection).** A first-class, living station object:
  a placeable `connector_portal` prop (CATALOG/`comms`, 1×2) drawn PROCEDURALLY in the phosphor pixel-art
  style (`propsprites.js` `F.connector_portal`) — a gateway pylon whose crown aperture + status lamp + conduit
  ride the BOUND connector's LIVE state (green=connected · amber=offline · red=error · grey=unbound), and which
  fires a bright packet up-and-out the aperture when ITS tools are called. Wiring:
    - **Per-instance binding (the real wrinkle vs. generic caps).** `CAP_PROP_MAP.connector_portal = 'connector'`;
      `worldmodel.bayObjects` emits `{ objectType:'connector', connectorId }` per BOUND portal (NOT deduped),
      `projectGeometry` carries `connectorId` to the renderer, and `world.js`'s plan hash serializes it so a
      re-bind re-POSTs. `bindConnector(propId, id)` sets/clears the binding (new mutation, undo-snapshotted).
    - **Sidecar contract.** `router.stationFor` now passes a rich `{ objectType, connectorId }` object through
      verbatim (string caps still map to `{ objectType }`); `resolveTools` yields no static grant for it (the
      MCP tools are projected dynamically by the connector manager keyed on `connectorId`).
    - **Builder UX.** `build.js` `openConnectorEditor` (via `PROP_EDITABLE`/`openPropEditor`) lists the live
      `/api/connectors` set to bind/unbind on place/click; the REFIT validator marks an UNBOUND portal amber
      (like NO COMPUTE).
    - **Live + firing.** `world.js` polls `/api/connectors` → `PropSprites.setConnectorState`; an `mcp__<id>__*`
      tool call (hero re-emitted onto `U.bus` by `chat.js`) resolves to the bound portal → `pulseConnector`.
  Tests: `worldmodel.test.js` (bayObjects connector emission + `bindConnector`) and `routing.b5.test.js`
  (`stationFor` rich-object passthrough). `test:fast` green; browser-verified (palette + sprite renders every
  state with no throw, zero console errors).

## Open decisions for andro

1. **Auth:** bearer-token paste only for the MVP, or full OAuth 2.1 device-code flow (dovetails with
   the planned ChatGPT/Codex OAuth work)?
2. **Connector scope:** station-wide (any agent with a portal) vs. per-agent (only the agent whose
   bay holds the portal)? Per-agent matches the existing per-bay capability isolation (B5).
3. **stdio in scope at all**, or remote-only until the `terminal`/shell.exec jail exists?

## Guardrails honored

- New code under `sidecar/mcp/` + a new test; `shared/events.js` / `shared/schema.js` untouched
  (additive, no owner-gated change). `CAP_REGISTRY` edit (Slice 4) is in `sidecar/`, not the
  owned contract.
- Pure modules, injected deps, no ambient time/randomness (passes `lint-determinism`); no new
  literal `emit()` names (passes `lint-emits`).
- `npm run test:fast` green before any merge to trunk.
