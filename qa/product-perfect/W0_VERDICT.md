# W0 advertised-claims verdict

> Audit base: `ef16fa087ad872f9d266ecde8b72ef813cb9ca82` (2026-07-12). This is static/code authority only; it does not substitute for clean-installed or attended live proof.

## Current machine verdict

- Planning: **PASS** — 37 finite material claim families, 17 W2–W6 grep-verdict rows, 5 protected exceptions, and 162 exact public-surface files.
- Terminal: **BLOCKED** — open FIX/COMPLETE/NARROW work, point-of-use experimental labels, and required live receipts remain intentionally pending.
- Reproduce planning: `node scripts/qa/product-perfect/claims.mjs --planning`.
- Reproduce terminal: `node scripts/qa/product-perfect/claims.mjs --terminal` (exit 2 while blocked).
- Refresh after an accepted source merge: `node scripts/qa/product-perfect/claims.mjs --refresh-surface` prints a read-only replacement lock to stdout; review and apply it explicitly.

The release-surface path-set hash is `268ce5981e8b6049b7eade5ef9cbf89f1cfba0a7b4eed108d6657ad0b03b3177`. The locked scope is every tracked `frontend/**/*.js`, `frontend/**/*.html`, and `frontend/**/*.css` file plus README, install, privacy, terms, release notes, and download-page marketing documents. A changed byte, deleted path, or new tracked frontend JS/HTML/CSS path blocks planning until re-audited. Runtime inspection derives the current candidate commit first, loads this claims manifest from that candidate's Git tree rather than the ambient filesystem, proves the recorded source snapshot is an ancestor, and rechecks every locked byte and locator before emitting the raw candidate-ledger SHA plus deterministic manifest and surface digests.

Verdicts: EXPERIMENTAL 2 · MISSING 1 · PARTIAL 11 · REFUTED 4 · SHIPPED 19. Dispositions: COMPLETE 6 · EXPERIMENTAL 2 · FIX 3 · NARROW 7 · PROVEN 19.

Every row records the exact current user-facing locator, code or absence checks, the audited trunk/branch/worktree scope, its amended owner wave, and whether live proof is still required. Duplicate literal copy is folded into one material family.

## Material claims

| ID | Domain | Verdict / disposition | Wave | Live | Qualification |
| --- | --- | --- | --- | --- | --- |
| `first-boot-onboarding` | core | **SHIPPED** / PROVEN | W1 | PENDING | Static wiring exists; the clean installed under-ten-minute journey remains required. |
| `byok-chatgpt-connect` | core | **SHIPPED** / PROVEN | W1 | PENDING | Wiring is present; installed provider-connect proof remains required. |
| `provider-catalog-custom` | integrations | **PARTIAL** / COMPLETE | W6 | PENDING | Catalog rows exist, but every advertised provider lifecycle has not been proven installed. |
| `post-onboarding-base-url` | recovery | **MISSING** / FIX | W3 | PENDING | The engine and onboarding writer exist; Settings exposes no writer. |
| `persisted-real-roster` | core | **SHIPPED** / PROVEN | W1 | PENDING | Browser and sidecar roster seams exist; installed restart proof remains required. |
| `concurrent-agent-runs` | core | **SHIPPED** / PROVEN | W1 | PENDING | Concurrency admission and delegation code exist; clean installed journey remains required. |
| `comms-real-workflow` | work | **SHIPPED** / PROVEN | W1 | PENDING | Core seams exist; installed end-to-end proof remains required. |
| `truthful-tools-cost-work` | work | **SHIPPED** / PROVEN | W6 | PENDING | Telemetry reducers are present; terminal proof still needs live reconciliation. |
| `object-capability-grant` | capabilities | **SHIPPED** / PROVEN | W4 | PENDING | The object-to-tool projection exists; W4 live mode matrix must re-prove it. |
| `room-capability-team` | capabilities | **PARTIAL** / NARROW | W4 | PENDING | Object grants are real, but most gear is explicitly station-shared rather than room-team scoped. |
| `hallway-authorized-handoff` | capabilities | **REFUTED** / NARROW | W4 | PENDING | Hallways are geometry; no authorization implementation was found on trunk, branches, or worktrees. |
| `layout-is-workflow` | capabilities | **PARTIAL** / NARROW | W4 | PENDING | Placed objects affect tools, while orchestration remains tool-driven rather than graph-edge driven. |
| `one-click-mutation-approval` | security | **PARTIAL** / NARROW | W2 | PENDING | Full-access and unattended modes bypass interactive prompting by design; copy must state that qualification. |
| `project-bless-revoke` | security | **SHIPPED** / PROVEN | W2 | PENDING | The grant/revoke path exists; live installed path proof remains required. |
| `night-patch-safe-branch` | autonomy | **SHIPPED** / PROVEN | W4 | PENDING | The guarded patch path exists; a real-project installed proof remains required. |
| `jailed-open-deliverables` | work | **SHIPPED** / PROVEN | W3 | PENDING | OPEN and jailed serving exist; installed-open proof remains required. |
| `unified-work-deliverables-ledger` | work | **PARTIAL** / COMPLETE | W3 | PENDING | The data and separate views exist, but there is no single unified ledger/library. |
| `routines-visible-unattended` | autonomy | **SHIPPED** / PROVEN | W4 | PENDING | Scheduler and UI exist; the app process must remain running. |
| `night-shift-away-work` | autonomy | **SHIPPED** / PROVEN | W4 | PENDING | Server-owned cadence exists; first installed real-provider overnight remains required. |
| `work-after-app-close` | autonomy | **REFUTED** / NARROW | W5 | PENDING | The product is one sidecar owned by the app; closing the app ends it. |
| `morning-report` | recovery | **SHIPPED** / PROVEN | W3 | PENDING | The report engine/store exist; an attended installed return remains required. |
| `learning-improves-over-time` | autonomy | **PARTIAL** / COMPLETE | W4 | PENDING | Context and rejection memory exist, but measurable longitudinal compounding is not proven. |
| `telegram-discord-messaging` | integrations | **SHIPPED** / PROVEN | W6 | PENDING | Adapters and UI exist; real-token connect/fail/revoke proof belongs to W6. |
| `slack-matrix-signal` | integrations | **EXPERIMENTAL** / EXPERIMENTAL | W6 | PENDING | Adapters exist, but point-of-use cards lack experimental labels and real-token proof. |
| `channel-token-keychain` | security | **PARTIAL** / FIX | W2 | PENDING | Desktop keychain coverage is limited to Telegram and Discord; Slack/Matrix/Signal need verified migration/read-back. |
| `manual-mcp-connect` | integrations | **SHIPPED** / PROVEN | W6 | PENDING | Manual manager paths exist; W6 still needs live connect/fail/revoke evidence. |
| `curated-mcp-auth-tiers` | integrations | **EXPERIMENTAL** / EXPERIMENTAL | W6 | PENDING | Catalog and OAuth plumbing exist, but lifecycle proof and point-of-use experimental labelling are incomplete. |
| `local-first-no-account` | privacy | **SHIPPED** / PROVEN | W2 | PENDING | The app server and stores are local; third-party provider/channel/update traffic remains qualified. |
| `no-analytics-telemetry` | privacy | **SHIPPED** / PROVEN | W2 | PENDING | Exact tracked shipped-source grep is clean for the named analytics/crash SDK endpoints. |
| `no-phone-home` | privacy | **REFUTED** / NARROW | W2 | PENDING | Google Fonts and the boot-time OpenRouter catalog warm contradict the blanket claim. |
| `secrets-keychain-never-render` | security | **PARTIAL** / FIX | W2 | PENDING | Provider keys and Telegram/Discord are covered; Codex/Spotify and three channels remain outside that blanket. |
| `crash-safe-forward-corrupt-recovery` | recovery | **PARTIAL** / COMPLETE | W3 | PENDING | Protected sidecar stores are hardened, while browser station state still uses localStorage and full recovery proof is incomplete. |
| `full-backup-export-restore` | recovery | **PARTIAL** / COMPLETE | W3 | PENDING | The full engine exists but Settings reaches only the smaller station backup surface. |
| `three-platform-release-pipeline` | release | **PARTIAL** / COMPLETE | W7 | PENDING | Pipeline configuration exists; clean installed proof for every artifact is absent. |
| `self-update-verified` | release | **REFUTED** / NARROW | W7 | PENDING | Automatic checks default off and the blanket verified-live statement lacks installed evidence. |
| `free-no-markup-budget-caps` | release | **SHIPPED** / PROVEN | W6 | PENDING | Budget enforcement exists; free/no-markup remains an owner business-policy claim. |
| `one-click-estop` | security | **SHIPPED** / PROVEN | W0 | PENDING | Durable halt and UI control are already shipped; do not rebuild. |

## W2–W6 grep-verdict matrix

| ID | Verdict / disposition | Qualification |
| --- | --- | --- |
| `W2-secret-free-child-env` | **PARTIAL** / FIX | MCP stdio builds a bounded child env, while shell/browser/computer/desktop retain ambient process access. |
| `W2-dns-safe-navigation` | **PARTIAL** / FIX | web_fetch resolves DNS; browser.navigate checks URL syntax/host classes without DNS resolution. |
| `W2-link-junction-containment` | **PARTIAL** / FIX | The path guard checks the deepest existing realpath, but no handle-relative/no-follow boundary closes TOCTOU. |
| `W2-channel-pairing` | **PARTIAL** / FIX | The shared adapter still uses trust-on-first-use owner claiming. |
| `W2-scoped-url-capabilities` | **MISSING** / FIX | SSE and file loads accept the global launch token in the query string. |
| `W2-mcp-mutation-consent` | **SHIPPED** / PROVEN | MCP translation maps readOnlyHint to requiresConsent. |
| `W2-zero-boot-egress` | **MISSING** / FIX | The sidecar warms OpenRouter models at server listen and the frontend loads Google Fonts. |
| `W2-channel-token-keychain` | **PARTIAL** / FIX | The shell keychain allowlist contains exactly Telegram and Discord. |
| `W3-unified-work-ledger` | **PARTIAL** / COMPLETE | Workstreams and return cards exist separately; unified browse/search is absent. |
| `W3-cold-boot-recap` | **SHIPPED** / PROVEN | Return and morning-report stores already hydrate and render recap paths. |
| `W3-settings-full-export` | **PARTIAL** / COMPLETE | Backup.exportAll exists, but the Settings control is the smaller station backup. |
| `W3-settings-base-url` | **MISSING** / FIX | Harness.setBaseUrl exists only in onboarding paths. |
| `W4-run-mode-capability-matrix` | **PARTIAL** / COMPLETE | Individual posture/capability engines exist; a complete enforced/not-enforced decision list is not yet authority. |
| `W5-after-close-continuation` | **REFUTED** / NARROW | Single-process desktop ownership means close stops the sidecar; this is a copy-honesty fix. |
| `W5-unified-composer` | **MISSING** / COMPLETE | Context pack, dossier, goals, recall, and threads remain separate composition paths. |
| `W5-rejected-idea-suppression` | **PARTIAL** / COMPLETE | Thread-level permanent suppression and reason fields exist, but the unified composer is absent. |
| `W6-real-integration-lifecycle` | **MISSING** / COMPLETE | No exhaustive installed real-credential lifecycle receipt exists. |

## Protected do-not-rebuild results

- `durable-estop-halt` — Durable Night Shift halt is already implemented and test-covered.
- `consent-visibility` — Background pending consent already receives an explicit visible marker/notification.
- `night-beat-leash-pre-spend` — Night Shift readiness stands down before spending a leash unit.
- `api-version-truth` — The honest /api/version handler already exists.
- `degraded-workspace-200` — The locked degraded-save contract is HTTP 200 with ok:false,degraded:true.

## Terminal closure rule

Planning may pass while product work remains open. Terminal authority passes only when every material claim is PROVEN with any required live receipt, or is visibly labelled EXPERIMENTAL at its point of use, and every W2–W6 grep-verdict row is closed. A hand-authored status, stale source lock, marketing-only label, or browser/dev substitute for installed proof remains blocked.
