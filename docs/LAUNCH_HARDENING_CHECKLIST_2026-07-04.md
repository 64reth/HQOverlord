# Launch hardening checklist — 2026-07-04 audit

Produced by a 4-lane audit (security, unfinished work, repo hygiene, ship readiness) with
every load-bearing claim re-verified against trunk `feat/harness-backend` (fdd7f721).
Gate status at audit time: `npm run test:fast` GREEN (234 files, no skipped tests).

Legend: **[BLOCK]** = do before public launch · **[SHOULD]** = strongly recommended ·
**[NICE]** = polish, non-blocking.

---

## Phase 1 — Secrets & privacy (do first)

1. **[BLOCK] Rotate the OpenRouter dev key.** A live key sits in `dev/.env.dev`
   (`sk-or-v1-c7e3…`). Verified: the file is untracked/gitignored and the key has NEVER
   been committed — every `sk-or-v1-` in git history is a test fixture or redaction
   pattern, so **no history rewrite is needed**. But rotation was already a standing
   follow-up from the 2026-07-02 security audit and is still not done. Revoke in the
   OpenRouter dashboard, mint a fresh one, update `dev/.env.dev` and `memory/.openrouter-key`.
2. **[BLOCK] Fill the `ANDREW_SUPPORT_EMAIL` placeholder in PRIVACY.md** (lines 10 and 136).
   A privacy policy with a literal placeholder is launch-embarrassing. Decide whether the
   released exe should carry a real support address (remember: email is baked into the exe
   at build time — re-cut after changing it).

## Phase 2 — Repo hygiene (before tagging / making source public)

3. **[BLOCK] Delete `thronglets_unity.html`** — a ~2MB cached third-party Unity blog post
   at repo root. Zero reason to exist.
4. **[BLOCK] Gitignore `release/`.** It currently holds the 27MB `StarNet_0.1.8_x64-setup.exe`
   + sig + latest.json, untracked but one `git add .` away from being committed forever.
   Add `release/` to `.gitignore`.
5. **[SHOULD] Sweep the untracked dev-process docs off the shippable tree.** These leak
   internal process, machine paths (`C:\Users\<you>\...`), and the Skynet codename:
   - Root: `AGENTS.md`, `AUTONOMOUS_BUILD_PLAN.md`, `CODE_MAP.md`, `REF_HARNESS_PARITY_PLAN.md`,
     `ORCHESTRATION_PLAN.md`
   - `docs/*_PLAN.md` / audit files (12+), `loops/`, `design/mockups/*.html`,
     `design/minion_backup_preset/`, `dev/.scratch-mock-cron/`
   Disposition: archive to a private branch or `.claude/archive/`, or gitignore. Note the
   already-TRACKED root docs (`SKYNET_BUILD_PLAN.md`, `WIRING_AUDIT.md`, etc.) deserve the
   same review if the source repo goes public.
6. **[SHOULD] Add `dev/.scratch-*/` to `.gitignore`** (only `dev/.scratch-workspace/` is
   covered today; `dev/.scratch-mock-cron/` is not).
7. **[NICE] Set root `package.json` version to 0.1.8.** Tauri + Cargo agree at 0.1.8 and
   release preflight checks those two; root `0.0.0` is harmless but confusing. Either sync
   it or add a comment-adjacent note in the release doc that root version is unused.

## Phase 3 — Truthful-telemetry gaps (silent failure fixes)

The product law is "the app never asserts state the harness can't prove." The audit found
no fake features or stubs, but a systemic pattern of `.catch(() => {})` that lets the UI
silently drift from sidecar truth. Fix the top tier; triage the rest.

8. **[BLOCK] `sidecar/index.js:1965`** — `/api/run` handler errors do
   `res.end()` with no status/body → client sees a 200-ish empty success and can wait
   forever. Return a 500 with a JSON error envelope.
9. **[SHOULD] `frontend/app/app.js:652`** — `/api/limits` fetch failure silently leaves
   `concurrentCap = null` → concurrency cap silently off. Fall back to a safe default cap
   and surface the degraded state.
10. **[SHOULD] `frontend/app/app.js:782`** — roster POST failures swallowed → crew
    assignments never reach the sidecar, team.dispatch breaks invisibly. Retry + surface.
11. **[SHOULD] `frontend/app/harness.js:197`** — keychain `harness_store_provider_key`
    failure swallowed → user thinks their API key saved when it didn't. This one directly
    burns a first-run user; surface the failure in the key panel.
12. **[SHOULD] Triage the remaining silent catches** from the audit list (skills fetch
    app.js:1725, checkpoint restore app.js:1921, workshop grant app.js:246, model picker
    marketplace.js:976, steer response chat.js:2865, workshop parked-without-reason
    workshop-store.js:155, transcript null autosessions.js:96). Minimum bar: log to the
    diagnostics ring so COPY DIAGNOSTICS captures them, even where no UI surface is added.

## Phase 4 — Release pipeline & first-run (mostly verified healthy)

13. **[SHOULD] Confirm the 0.1.8 GitHub Release is up and the updater round-trips.**
    Config is healthy: endpoint `github.com/nonfungiblefunyuns-ship-it/starnet-releases/releases/latest/download/latest.json`,
    `createUpdaterArtifacts: true`, sig freshness checked by `scripts/release-cut.mjs`,
    t4/t5 release-gate tests green. Remaining human step: Andrew uploads artifacts + tag
    `v0.1.8` and a real machine on 0.1.7 receives the update.
14. **[SHOULD] Fresh-machine smoke test:** clean Windows VM (or at least a fresh user
    profile), install the exe (Smart App Control roulette check), first-run with NO key →
    BYOK panel → paste key → first agent run → close/reopen persistence. This exercises
    exactly the surfaces the silent-catch bugs above hide.
15. **[NICE] Add rotation (or a documented cap) for `skills.jsonl` / `skillprefs.jsonl`** —
    the only unbounded logs; ledger/runstore/transcript are properly bounded at 16MB with
    `.1` rotation and redact-on-write.

## Phase 5 — Final gate

16. **[BLOCK] Re-run `npm run test:fast` after all fixes** — full green, no skips.
17. **[BLOCK] Re-cut the release LAST** (after email fill-in and any frontend fixes — the
    exe bundles frontend + email at build time), via `release-cut.mjs` (preflight +
    signing-stall + E0463 guards are already encoded there).
18. **[SHOULD] Live-verify the cut installer** per starnet-verify before announcing.

---

## What the audit found HEALTHY (no action)

- **Security posture is genuinely strong:** sidecar binds 127.0.0.1 only; every `/api/*`
  route token-guarded with timing-safe compare; CORS origin allow-list + Host validation
  (anti-DNS-rebind); fs/shell tool jail with symlink + `..` checks; comprehensive SSRF
  guard in web.js (RFC-1918/loopback/link-local/hex-IP/rebind); no eval/dynamic require;
  `U.esc()` on model output; secrets redacted on export and on log-write.
- **No secrets in git history** (verified with `git log -S`).
- **No skipped tests, no "coming soon" stubs, no hardcoded machine paths in shipped code.**
- **Release script** (`release-cut.mjs`) encodes every past release gotcha as a preflight.
- **Dev seeds/test APIs** properly gated behind `SKYNET_DEV`/`__STARNET_DEV__`, inert in
  packaged builds.
