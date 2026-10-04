# Hostile QA sweep — 2026-07-04

**Target:** live seeded app on `:8853` (`hostile-qa-seed` → `dev/seed.js`), app `0.1.8`, harness `0.0.0`, Node v22.23.0.
**Method:** interactive UI attack via browser DOM round-trips + network/console inspection (canvas screenshots time out — known gotcha), plus a parallel background agent fuzzing all ~90 `/api/*` routes with malformed/oversized/traversal/auth-edge input. Everything below was reproduced live. Seed workspace is a throwaway; roster was restored after the one destructive backend test.

**Headline:** No crashes, no security holes. The **backend is hardened** (filesystem jail airtight, zero 500s, zero secret leaks, auth correct on every route, human-readable errors, server survived the whole session). The real bugs are in the **frontend UX layer** — chiefly that parameterized slash commands typed inline silently fire a wasted LLM run instead of executing, and one backend route (`/api/roster`) that destroys persisted state on malformed input.

---

## P1 — broken feature / destructive-on-bad-input

### 1. Parameterized slash commands typed inline never execute — they fire a wasted (here, failed) LLM run
- **Repro:** In COMMS type `/model gpt-4o` (or `/title Foo`, `/goal do X`, `/resume 2`) and press Enter.
- **Observed:** the text is echoed as a `COMMANDER` chat message and a **live run fires** (in this seed → `■ RUN FAILED · 0s`). The model is *not* changed; the workstream is *not* renamed.
- **Cause:** typing the space+argument makes `matchCommands("model gpt-4o")` return zero matches, so `openSlash` calls `closeSlash()` ([chat.js:3345](frontend/app/chat.js:3345)). With the palette closed, Enter routes to `send()` ([chat.js:363](frontend/app/chat.js:363)) instead of `runSlash`. `send()` never re-parses slashes. There is **no way to pass an argument to a client slash command by typing** — the palette is only open when the box holds just the bare command name.
- **Why it matters:** `/help` and the commands themselves advertise `<args>` (`/model <model-id>`, `/title <name>`, `/goal <what you want done>`). Following the documented syntax silently spends an LLM run and posts your "command" to the model as chat.
- **Fix direction:** in the Enter handler, if the input starts with `/` and the first token matches a known command, dispatch it (with the trailing args) even when the palette is closed.

### 2. `POST /api/roster` silently WIPES the persisted roster on malformed/missing input
- **Repro:** `POST /api/roster` with `{}`, `null`, `{"agents":"hello"}`, or `{"agents":12345}`.
- **Observed:** each returns `200 {ok:true,count:0}` and drops `agentCount` 1→0, persisting an empty roster to `agent.roster.json` (and rolling the good copy out of the `.bak`).
- **Cause:** `handleRoster` ([index.js:3305](sidecar/index.js:3305)) coerces a missing/non-array `agents` field to `[]` then unconditionally `replaceAgentRoster([]) + saveAgentRoster()`.
- **Why it matters:** a malformed request causes silent, persisted destruction of server state and still reports `200 ok`. Only recoverable because the browser's separate `agent.save.json` re-pushes on next boot.
- **Fix direction:** reject when `agents` is absent or not an array (`400`), don't coerce to `[]`.

---

## P2 — confusing behavior / missing state / wasteful

3. **Seed default model 404s on OpenRouter.** Every live run in this config fails: `openrouter http 404 — No endpoints found for anthropic/claude-3.5-sonnet`. The catalog is ~340 mostly-fictional future slugs, so this is a **dev-seed config issue**, not proof of a shipping bug — *but* if the shipped default is ever a dead slug, first-run = immediate failure. The error card UX itself is **good** (clear line + "⚙ Open Settings" + "📋 copy diagnostics"). **Action:** confirm the production default model is a live, reachable slug.

4. **Opening Settings fires a burst of ~100+ redundant `GET /api/connectors`** (plus repeated `/api/budget/status`, `/api/insights`, `/api/cron`). Not an ongoing leak (quiescent afterward), but a heavy render-time burst — each provider row re-fetches independently. Wasteful, worse on the desktop build / slow disk.

5. **A summoned agent isn't immediately reachable in the COMMS "who you're talking to" selector.** After SUMMON the agent is correctly in the roster + CREW MANIFEST (unique ids), but the selector only rebuilds on a workstream switch/reload — so you must click the manifest entry (creates a stream) then click that stream row to actually talk to it. Two indirection steps.

6. **Oversized request bodies get a raw TCP reset (curl error 56), not a clean `413`.** Bodies over a route's limit trip `readBody`'s `req.destroy()`, so a well-behaved client can't distinguish "too large" from a crash/network drop. Affects `/api/memory/edit` (64KB), `/api/roster` (2MB), `/api/save` (8MB).

7. **Chat input hard-capped at 500 characters** (`<textarea maxlength=500>`). A detailed task prompt or paste is silently truncated — no counter, no warning. Low for a "chat," tight for an agent task directive.

---

## P3 — polish / minor

8. Unknown slash `/xyz` silently closes the palette with no "unknown command" feedback; Enter then sends it to the LLM as chat.
9. Leading whitespace defeats slash detection: `   /help` never opens the palette ([chat.js:375](frontend/app/chat.js:375) checks `v[0] === '/'`).
10. Placeholder text `"speak to your agent…"` vs aria-label `"Message your agent"` — inconsistent copy on the same field.
11. **Duplicate class summon → indistinguishable agents.** 2nd Engineer correctly gets unique id `engineer-2`, but display name is identical `ENGINEER`; the COMMS selector and manifest show two `ENGINEER` with nothing to tell them apart.
12. Summoned agent shares NOVA's `HAB-01` slot in the manifest display, and its manifest line is missing the `· Lv 1` that NOVA's shows.
13. Escape closes the Recruitment Bay but not the Settings window (Settings closes only via ✕ / it's a draggable window, not a backdrop-modal) — inconsistent dismissal.
14. `GET /api/execution` returns the absolute user path (`C:\Users\<you>\Desktop\gen\dev\.scratch-workspace`). Token-gated, low risk, but `/api/diagnostics` deliberately avoids paths while this route exposes the home dir.
15. Several routes coerce wrong-type fields instead of rejecting: `/api/memory/reset {agentId:99999}` → `"99999"`; `/api/goals {goal:42}`, `/api/dossier` accept/coerce. All return honest results, none 500.
16. `GET /api/models/<bogus>` and `/api/models/` silently fall back to the OpenRouter catalog rather than 404-ing an unknown provider.
17. `POST /api/auth/codex/start` fires a **real** OpenAI device-auth request on empty/`{}`/`null` body — a token-holder could spam OpenAI's endpoint through it.
18. `POST /api/subagents/interrupt {id:"nope"}` → `200 {ok:false,"no such subagent"}` instead of `404` (inconsistent with sibling routes).
19. Wrong-method requests (GET a POST route, etc.) fall through to `404 "not found"` as unlabeled `text/plain` (fine, just no `Content-Type`).

---

## Verified working / good (not bugs)

- **Filesystem jail is airtight.** `../../../../etc/passwd`, `..\..\Windows\win.ini`, `C:/Windows/win.ini`, URL-encoded `%2e%2e`, double-encoded `%252f`, `....//`, null-byte, and `/shared/..%2findex.js` all → `403`/`404`. Positive control (a real in-jail file) → `200`.
- **Auth correct everywhere.** No-token / wrong-token / query-token-on-header-route all → `403 forbidden token`, no leak. `/api/file` accepts `?token=` for GET/HEAD only. SSE token path validated. Exempt routes reachable by design.
- **No secret leaks.** `/api/config/export` and `/api/diagnostics` grepped clean for keys/tokens/Bearer/username.
- **Chat rendering is XSS-safe** — escape-then-linkify, regex only matches `https?://` and escapes both href and text; no `javascript:` injection ([chat.js:262](frontend/app/chat.js:262)).
- **Budget caps validation is solid** — negative/non-numeric → inline `"perRun: enter a number ≥ 0 (leave blank or 0 for no cap)"`, focuses the bad field, blocks the save ([stationui.js:2218](frontend/app/stationui.js:2218)).
- **Workstream handling is solid** — General is delete/archive-protected ([app.js:2256](frontend/app/app.js:2256)); Delete is a two-click armed confirm within 4s ([app.js:2271](frontend/app/app.js:2271)); empty rename cancels.
- **Empty/whitespace chat send is blocked** ([chat.js:366](frontend/app/chat.js:366)).
- **Persistence works** — 3 summoned agents + their workstreams survived a reload; the selector correctly listed all 3 afterward.
- **Responsive layout holds at mobile (375px)** — no horizontal overflow, chat input + all 4 dock buttons visible.
- **Server survived the entire hostile session** — `/api/health` and `/api/version` = `200` at the end; zero browser console errors; ~45 POST routes fuzzed with garbage returned clean, human-readable errors with no stack traces (the roster P1 was the only silent-destructive exception).
