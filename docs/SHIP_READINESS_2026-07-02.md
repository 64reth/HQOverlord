# Ship readiness — 2026-07-02

> Living checklist for cutting the next desktop build off `feat/harness-backend`.
> Companion to docs/GAME_SESSION_PLAN.md (G0-G4 all SHIPPED — see memory/plan for
> per-phase evidence). Update statuses in place; delete this doc once shipped.

## What ships
Everything on trunk: the full Game session (floor truth, generative quests +
MISSION BOARD, return ritual + OUTBOX, pride layer + TROPHY CASE, embodiment),
PLUS the parallel sessions' work (first-ten onboarding rebuild, QA station lanes,
tall walls, all-84-prop art overhaul, settings-parity P0s, CRT feed).

## Gates

| # | Gate | Status | Notes |
|---|------|--------|-------|
| 1 | `test:fast` green on trunk | ✅ (after every merge, repeatedly) | protocol gate |
| 2 | FULL `npm test` (validate+world+fast+http) on trunk | ✅ GREEN (exit 0, trunk @69fda46) | first run caught cron.api isolation hole — root-caused (a live ChatGPT login on the machine made "no provider credentials" false via the codex-token migration; product behavior correct), test sandboxed (69fda46) |
| 3 | Headless UI sweep (npm run shoot) on merged trunk | ✅ | 17/17 states, 0 console errors, 0 exceptions |
| 4 | Live-LLM smoke (real OpenRouter key) | ✅ PASSED | `npm run phase5:workload` on the fresh key: workload=true restart=true, live tools exercised = browser_navigate, browser_get_text, computer_use, shell_exec, fs_write, notebook_write; evidence + 4 floor captures at `.dogfood/phase5-workload-20260702-052205/` (03-workload-complete.png shows the live run on the floor, 12k real tokens) |
| 5 | Andrew's attended playtest (~10 min, `npm start`) | ⏳ NOT YET DONE | Andrew said proceed to ship before this ran; recommended before/soon after upload, not blocking the build |
| 6 | Desktop build + sign + manifest | ✅ DONE | v0.1.3, trunk @efd57d8. `TAURI_SIGNING_PRIVATE_KEY` (not `_PATH` — that name is only read by t1-signing.mjs's evidence check, the Tauri CLI itself wants the bare var) pointed at the key file, empty password. Signed with pubkey `FF7E32DB22213F8C` — matches tauri.conf.json's pinned pubkey, verified byte-for-byte. Installer+`.sig`+`latest.json` (with real release notes) staged in `release/`, stale 0.1.1 artifacts removed |
| 7 | Upload to updates.starnet.app | ⏳ Andrew | manual — no deploy creds in repo. Upload `release/StarNet_0.1.3_x64-setup.exe` and `release/latest.json` to `/desktop/` on that host (the exact paths the pinned config + manifest already point at) |

## Known non-blockers (tracked, shippable as-is)
- Crew-scoped approval walk-and-wait (G4 is hero-scoped; delegated workers ride the lead's stream)
- Cron-jam routine-name cache (cards say "a routine"; jobName() seam in place)
- G5 spectacle (postcard/clip export) — next session
- Desk progress strip renders empty until a real progress producer exists (honest by design)
- `image_*` prop pulse requires a placed STUDIO (prop exists now; unplaced = honest no-op)

## Ship decision rule
Gates 2+4 green + gate 5 thumbs-up → cut the build same day (gates 6-7).
Any gate red → fix in a lane, re-run that gate only.
