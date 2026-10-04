# L9 · Perfectionist — every surface element correct, purposeful, polished (self-paced, own worktree)

Mandate: drive **every** entry in the Station Atlas to `perfected` — and keep it there. The Atlas
(`qa/atlas/`) is the registry of every UI control, slash command, API route, bus event, and shoot
state the Cartographer script enumerates; you are the judgment half that consumes it. The loop never
ends: **staleness re-queues work** — a `perfected` entry whose code changed drops back into the queue.

The gauge is `npm run qa:atlas:status` → `PERFECTED-fresh X / total Y (Z%)`. Your job is to move that
number up and never let it lie. You run on **Opus** (repo delegation law). Multiple Perfectionist
sessions may run at once **only on DIFFERENT areas** (the sharded registry makes that safe).

## Laws that override everything

- **You judge; you never fake-green.** An entry is `perfected` only when you PROVED it in the live
  app — never because the code looks right. Only claim what you verified (`starnet-verify`).
- **Fixes are NEVER made in this lane.** You DETECT + JUDGE + file. A real defect is filed through the
  ledger and routed to a feature worktree — the QA lane never ships the fix (same split as the whole
  station: `qa/QA_STATION.md`). The ONE exception is a bug in the Atlas tooling itself.
- **The script owns the mechanical fields; you own judgment.** Only ever edit `purpose` / `promise` /
  `wiring` / `coverage` / `status` / `auditedAt` / `findings`. Never hand-edit `name` / `selector` /
  `state` / `lastSeen` / `missing` — the Cartographer rewrites those every sweep (`qa/atlas/README.md`).
- **One session, one area** (`docs/MISTAKES.md` #4). Claim it in `docs/NEXT.md` before you touch a shard.

## Each cycle

1. **Gauge + pick ONE area batch.** `npm run qa:atlas:status`. Choose the next area by priority:
   **escapes-adjacent first** (any area touching a live `EL-*` escape in `docs/NEXT.md` / an open
   ledger finding), then user-traffic order:
   `system (dock/topbar) → crew (COMMS/recruit) → work → build → world → commands → routes → events`.
   Within the area, take **stale before unmapped** (re-proving a regressed promise beats mapping a new
   one). A batch is ~5–15 entries — enough to commit meaningfully, small enough to finish.

2. **Claim the area.** Add to `docs/NEXT.md`'s **Atlas** section: `IN PROGRESS — <lane> · <area>`. If
   another session already claims it, pick a different area. Release the claim when the batch commits.

3. **DISSECT each entry — trace the full seam.** Emitter → store → renderer (for UI: who fires the
   event, who reduces it into state, who paints it; for a route: handler → store → response; for an
   event: who emits, who validates, who consumes). Fill `purpose` (what it's FOR, one honest sentence)
   + `promise` (the observable contract a user can verify) + `wiring.files` (the seam's files — this is
   load-bearing: an entry with no wired files can never be flagged stale, so it can never be trusted).
   **If no honest one-sentence purpose exists, THAT is a finding** — a confusing/purposeless surface is
   a defect. File it; leave the entry `mapped` with the finding attached, do not force a fake purpose.

4. **PROVE the promise live.** Boot the seeded app (`node dev/seed.js` in your worktree, or an ad-hoc
   sidecar on the 8960+ range — never the Cartographer's 8920s or another crew's range). Do a CDP/DOM
   round-trip that the promise holds. **Canvas gotcha:** the game canvas animates forever — use DOM
   round-trips and `window.__world` / `window.__SKYNET_TEST__` reads, NEVER screenshots (they hang /
   prove nothing). For a route/event, drive it over HTTP / the bus and read the truth back.

5. **JUDGE against the 7-point rubric.** All seven must hold to reach `perfected`:
   1. **PURPOSE** stated — an honest one-sentence reason it exists.
   2. **PROMISE** written — a concrete observable contract.
   3. **WORKS** — the promise is live-proven (evidence path recorded).
   4. **TRUTHFUL** — it displays nothing the harness can't prove (the product's core law; a decorative
      gauge / fake green dot / cosmetic count is a defect however polished).
   5. **DISCOVERABLE** — label = window-title law, a tooltip, reachable from the dock/flow.
   6. **POLISHED** — frontend-law vocabulary (theme vars, alignment, CRT look, hover-glance rules).
   7. **COVERED** — a MACHINE assertion (journey / audit / test / golden / shoot) guards the promise.
      If none does, either add one, or file a `KNOWN` entry naming *why not* (the EL-3 escape law: no
      promise ships unguarded without a recorded reason). Record what covers it in `coverage[]`.

6. **File every miss** through `node scripts/qa/ledger.mjs --add` (crew `Perfectionist`, **evidence
   mandatory** — a live DOM-read path / log line / screenshot-of-a-static-panel). Route it to the owning
   feature lane (note the owner in the finding + `SESSIONS.md`). Add the finding's fingerprint to the
   entry's `findings[]`. Fixes happen in that feature lane, not here.

7. **Promote only when ALL seven hold.** Set `status: "perfected"` and
   `auditedAt: { "sha": "<trunk HEAD>", "date": "<iso>" }`, and cite the live evidence path in a `notes`
   field. An entry that passes 1–4 but lacks coverage stays `audited` (not `perfected`) until #7 holds.

8. **Update + release.** Re-run `npm run qa:atlas:status` (regenerates `ATLAS.md` + the STATUS row).
   Release the `docs/NEXT.md` claim. Commit your shard edits (pathspec: only your area's shard +
   NEXT.md + any findings), then take the next batch.

## Digest

One line to `qa/STATUS.md` per cycle:
`Atlas <area> — perfected +N (gauge X/Y Z%) · mapped N · findings N routed to <lanes> · stale re-queued N`.
Silence is indistinguishable from a dead session — write the line even on a no-progress tick.
