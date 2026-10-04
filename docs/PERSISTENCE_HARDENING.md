# Persistence hardening — crash-safe, concurrency-safe, bounded

The product bar is **"survives a crash/restart with ZERO data loss."** This change makes the sidecar's
persistence layer meet it. Three failure modes were fixed (P1 concurrency clobber, P2 non-durable writes
that fail-open-to-empty, P3 unbounded append-only logs), with focused adversarial tests for each.

All work is **behavior-neutral**: the happy path and on-disk format are unchanged, and every pre-existing
test passes. New primitives live in their own modules (mirroring `durable-write.js` / `cron-lock.js`) so
they are unit-testable against an in-memory fs — `sidecar/index.js` self-boots a server and cannot be
`require()`d by a test.

## The primitives

- **`sidecar/durable-store.js`**
  - `makeKeyedMutex()` — a per-key async mutex (one promise chain per key, pruned when idle). Serializes
    writes that share a key; an async critical section is held to completion before the next runs.
  - `readJsonResilient({fs}, file)` → `{ value, status }` where status is `ok` / `recovered` / `absent` /
    `corrupt`. Recovers a torn/zero-length/corrupt main from `<file>.bak`.
  - `writeJsonResilient({fs, path, writeDurable?}, file, value)` — snapshots the current good main to
    `<file>.bak` (last-known-good), then writes the new value via `writeFileDurable` (fsync-before-rename).
  - `makeDurableJsonStore({fs, path, fileFor, ...})` — `get` / `set` / **`update(key, mutator)`**. `update`
    is the safe write: it serializes per key and **re-reads the committed state inside the lock** before the
    mutator merges, then persists durably. Returning `undefined` from the mutator skips the write.
- **`sidecar/logbound.js`** — `tailLines` (positional last-N-bytes read, complete lines only),
  `loadBounded` (archive `.1` + live, bounded), `rotateIfLarge` (roll the live file to `.1` past a cap).
- Reuses the existing **`sidecar/durable-write.js`** (`writeFileDurable`) — the one fsync-before-rename
  primitive; no second durability primitive was invented.

## P1 — concurrency (no lost updates)

The notebook is a real read-modify-write of a per-agent disk snapshot, written from several places that
can be in flight for the **same agent** at once (recall-stats fold at run start, a `notebook.write` /
`notebook.feedback` tool call mid-run, the Memory-Core pin/edit/forget routes, memory turn-in, restore).
Runs are keyed by `runId`, not `agentId`, and the concurrency gate only caps distinct agents — so one
agent can have a browser run + a cron fire + a delegated sub-run live together. Every one of those call
sites now writes through **`notebookStore.update('notebook:'+agentId, mutator)`**, which re-reads under the
per-agent lock and persists durably. No committed memory can be lost to a stale-snapshot whole-array
overwrite.

The channel store's `appendTurn` / `saveChatRecord` are a **fully synchronous** read-modify-write (no
`await` between `readJson` and the write), so the Node event loop already serializes them per file —
concurrent in-process writers cannot interleave and lose a turn. They are now durable + recoverable too.

Roster, dossier, channel secrets, codex tokens, connectors and the permission allowlist are **full-state
writes of an in-memory snapshot** (not a disk-snapshot RMW), so they have no lost-update hazard and need no
per-key lock — durability + recovery is the fix they needed.

**Proof:** `test/durable-store.test.js` spawns 50 concurrent `update()` writers with **async** mutators to
one key and asserts all 50 persist — and a naive `get → await → set` baseline in the same test *does* lose
updates, so the mutex is demonstrably load-bearing. `test/channels.durability.test.js` fires N concurrent
`appendTurn`s and asserts zero lost turns.

## P2 — durability + recovery (never boots amnesiac)

Before: every store except cron used a plain `writeFileSync → rename` (atomic but **not** power-loss
durable) and a `catch → return empty` loader. A hard kill could leave a store zero-length, the loader
returned empty, and the next write made the empty state permanent — the agent's memory and identity wiped.

After: every protected single-file store (notebook, roster, dossier, channel secrets, codex tokens,
connectors, allowlist, channel history + chatmap) writes through `writeFileDurable` and keeps a `<file>.bak`
last-known-good. Loaders use the recovery read:

- main `ok` → use it.
- main missing/zero-length/corrupt **and** `.bak` good → **recover** from `.bak` (logged, not silent).
- main missing **and** `.bak` missing → **absent** → load empty. *This is the only case that loads empty*
  (a brand-new install/agent).
- main present-but-bad **and** no usable `.bak` → **corrupt** → the file is **quarantined** to
  `<file>.corrupt-<pid>-<n>` and logged loudly via `console.error`; it is never silently overwritten or
  treated as empty. (`clearCodexTokens` also drops the `.bak` so a sign-out can't be "recovered".)

**Proof:** `test/durable-store.test.js` and `test/channels.durability.test.js` simulate a torn
(zero-length) and a corrupt main with a good `.bak` and assert recovery (not amnesia), assert an absent key
loads empty, and assert an unrecoverable corrupt main is surfaced (onCorrupt fires) rather than silently
emptied.

## P3 — boundedness (boot stays bounded forever)

The append-only JSONL logs (`ledger.jsonl`, `runs.jsonl`, `transcript.jsonl`) were read into RAM **in full**
at boot and never rotated, so months of 24/7 use grow them until a single boot-time `readFileSync`
crash-loops startup. Now each loads only the last `LOG_MAX_BYTES` of (archive + live) via `loadBounded`
(positional tail read — never materializes the whole file), and `rotateIfLarge` rolls the live file to
`<file>.1` once it passes the cap. Boot RAM/latency **and** on-disk size stay bounded regardless of history
size. `LOG_MAX_BYTES` defaults to 16 MB (min 1 MB), env-overridable via `LOG_MAX_BYTES` /
`SKYNET_LOG_MAX_BYTES`.

**Proof:** `test/logbound.test.js` builds a ~200k-line / multi-MB file and asserts `tailLines` loads only a
small bounded tail with the newest record intact and every returned line complete; that rotation rolls the
live file; and that a `makeRunStore` wired exactly like the sidecar boots a bounded subset **fast** (<500 ms)
from a 50k-line history while its newest-first `list()` stays byte-correct.

## Residual limits (honest)

- **Windows directory fsync.** `writeFileDurable` fsyncs the temp file's bytes before the rename (durable)
  but cannot fsync the containing directory on Windows (no directory fd). That best-effort dir-fsync is a
  POSIX-only extra; the temp-fsync + atomic rename is the durability bar this project targets on Windows,
  and it is met. (Same limitation cron already lived with.)
- **Ledger global total past the rotation window.** Bounded loading keeps the trailing-day pool and recent
  per-agent/global totals exact; only *lifetime* spend older than ~`2×LOG_MAX_BYTES` (≈ tens of thousands of
  runs, far beyond the default `$100` global cap) drops out of `totalUsd()`. At 16 MB this never arises
  before the global cap has long since blocked the run, so the soft cap stays effective in practice.
- **In-memory log mirror during very long uptime.** The ledger/run/transcript stores keep their rows in
  RAM. Boot loads a bounded subset, so RSS *starts* bounded; a single process that runs for months without
  ever restarting still accumulates this-session appends in RAM. That is the pre-existing append-only-mirror
  behavior; it resets on restart and is out of scope for the boot crash-loop this change targets.
- **Todo persistence (pre-existing, untouched).** The `todo` tool shares `notebookStore` under a `todo:<id>`
  key that `notebookFile` rejects (it only strips a `notebook:` prefix), so todo writes silently no-op today.
  This change preserves that behavior exactly (out of scope) rather than altering it.
