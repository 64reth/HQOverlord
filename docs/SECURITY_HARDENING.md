# StarNet security hardening

Tracks the systemic-security fixes on the `agent/harness-security` lane. Each section states the threat
model so "fixed" is a decidable bar, not a vibe.

---

## #3 — Local API authentication (DONE)

### The holes (pre-fix)
- `POST /api/session` returned the per-launch API token to **anyone who asked** — a header-less local
  process could fetch the token for free, then drive every route.
- **GET data routes were token-exempt** (`requiresApiToken` skipped all GET/HEAD), so transcripts, memory,
  saves, and on-disk deliverables (`/api/file`) were readable with no token.

### Threat model (what "fixed" means)
- **PRIMARY (now defended):** a malicious **website** the user visits cannot drive the agent or read its
  data. Three layers: (a) Host pin defeats DNS-rebinding; (b) Origin allow-list rejects foreign origins;
  (c) a per-launch secret token is required as a **custom header** on every API call — a custom header
  can't be set cross-origin without a CORS preflight the server refuses, and cross-origin reads of our
  page/responses are opaque, so a site can neither forge nor steal it.
- **RESIDUAL (accepted, documented):** a process running as the **same OS user** can read the token (it is
  injected into the served page), the keychain, and the data files. That is inherent to a single-user
  loopback app — an OS-trust problem, not an app-layer one. We raise the bar (no free vending; token on
  every route) but make no claim to stop same-user malware.

### What changed
- New `sidecar/apiauth.js` — pure, unit-tested auth/guard logic (origin/host gating, `requiresApiToken`,
  constant-time header/query token checks). `index.js` keeps only thin res-writing wrappers.
- **Token required on every `/api/*` route, GET included**, except a documented header-less set:
  `/api/session`, `/api/key` (own IPC_TOKEN guard), `/api/health`, `/api/spotify/callback` (OAuth redirect),
  `/api/channels/events` (SSE — uses a `?token=` query since EventSource can't send headers).
- `POST /api/session` now vends the token **only to a trusted, present Origin** (a real browser / the desktop
  shell). A header-less caller gets `{ok:true}` and no token. Primary delivery is page injection.
- **Desktop (Tauri):** the bundled webview never fetched the token before. Now `main.rs` generates a
  per-launch `api_token`, passes it to the sidecar via `SKYNET_API_TOKEN` (read by `ENV('API_TOKEN')`), and
  injects `window.__STARNET_API_TOKEN__` in the init script — so desktop never calls `/api/session`.
- **SSE:** `frontend/app/world.js` opens the stream with `?token=…` and the sidecar base prefix (also fixes
  a latent desktop bug where the EventSource URL never reached the sidecar). Route match now compares path
  (query-tolerant). Server validates the query token in `handleChannelEvents`.
- Fixed a latent bug in `isAllowedHost` (the IPv6 `[::1]:port` strip mangled the address) surfaced by the
  new unit test.

### Verification
- `test/apiauth.test.js` (in `test:fast`, 42 assertions) — policy matrix: every data route gated, the
  exempt set, header + query token constant-time checks, origin/host gating.
- `test/sidecar.http.test.js` (in `test:http`, real booted server) — proves end-to-end: GET without token
  → 403; GET with token → 200; `/api/session` without Origin → no token; SSE without/with-wrong `?token`
  → 403; foreign origin → 403; served page injects the token.
- `npm run test:fast` and `npm run test:http` both green.
- **Not yet machine-verified:** the Tauri desktop path (needs a `tauri build`); the Rust change mirrors the
  proven `ipc_token` pattern exactly.
