# HANDOFF — v0.10.11 update readiness (2026-08-26)

> Historical snapshot: this handoff was written at `f92bcb339`. Trunk later advanced through
> credits-link self-healing (`0119207c6`), custom HTTP MCP OAuth (`b49f4198e`), and the resulting
> claims re-lock (`899ef3d8e`). Those later bytes require their own candidate-bound gates; the
> verdict below does not authorize a tag by itself.

Everything below is **VERIFIED** unless labelled otherwise. Audit + gate work done in session
95f94989; gates run at the exact trunk HEAD in a detached worktree per the merge ritual.

## Verdict at the recorded snapshot: GO to cut

Trunk `feat/harness-backend` @ **`f92bcb339`** was release-ready. Nothing on trunk since the
v0.10.10 tag was unfinished, ungated, or half-merged. The cut itself was deliberately NOT
performed (Andrew's instruction).

## Proof at the exact HEAD

- `test:fast` **689/689 GREEN** and `test:http` **84/84 GREEN**, both read from the log (not the
  exit code), run in a detached worktree at `f92bcb339` (worktree since reaped).
- Green Guardian independently stamped **GREEN @ f92bcb33, 2026-08-26 01:14Z** (qa/STATUS.md
  crew table — durable record).
- Every merge since the tag also earned both gates at its own merged SHA (entries in qa/STATUS.md,
  2026-08-25/26).

## What the snapshot carried

| commit | user-facing fix |
|---|---|
| `107c3b8ef` | "invalid model ID" strand: endpointless provider refuses instead of silently rerouting managed runs to api.openai.com; unresolved starnet link reads NOT CONFIGURED with the real remedy named |
| `0c84d88c5` | codex chat bricked forever: one orphaned function_call_output no longer 400s every later turn (pairing repaired at the Responses wire) |
| `1c413a90c` | fresh install stranded on PRIOR STATION DATA FOUND after one open/close: quit-path E-STOP bookkeeping is INFRA, never prior-station evidence |
| `14f7de6f7` | Higgsfield MCP "does not verify": catalog row with OAuth+DCR (mint live-proven to a real authorize URL; consent→tools/list needs a human login) |

None of these were on origin when this snapshot was written. v0.10.10 itself was published
(Latest, 2026-08-25 07:46Z, all three installers present) via the immutable-tag manual dispatch
after the train's Chrome-timeout failure; `0db1a968c` fixed that gate.

## Cut checklist recorded at the snapshot

1. Bump the version in all five canonical pins: `package.json`, both root entries in
   `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the
   `skynet-desktop` entry in `src-tauri/Cargo.lock`.
2. If `RELEASE_NOTES.md` is rewritten, that **owes a claims re-lock**.
3. Commit the untracked handoffs. `qa/STATUS.md` working-tree dirt is the Guardian's live
   auto-stamp and belongs in a separate QA commit.
4. Push trunk, then the immutable `v0.10.11` tag. A `v*` push fires the train; watch the run.
   If it dies, recover by workflow dispatch without moving the tag.
5. Windows and both macOS architectures are one publish gate. Reapply the per-release Linux
   404 workaround only if Linux/manual assets are staged.
6. Check free RAM before local gates/builds; exit 3221225773 is host starvation.

## Open threads recorded at the snapshot

1. **Unbilled inference:** recurring cloud logs showed unmetered completions and low OpenRouter fuel.
2. **Brandon remained stranded:** do not claim this release fixes his account/balance mismatch without
   resolving his device token to the actual account and balance on the backend.
3. **Custom add-by-URL OAuth:** open at this snapshot; subsequently implemented in `b49f4198e`.
4. Higgsfield consent → token exchange → tools/list still needs one human login to close.
