# Station Atlas — the perfection-loop registry

> **What this is:** a registry of **every** surface element in StarNet — every UI control, slash
> command, API route, bus event, and shoot state — each carrying its purpose, its observable promise,
> and its status on the road to *verified-perfect*. The QA Station (`qa/QA_STATION.md`) is a
> **regression** watch: it proves trunk stays green and the app keeps booting. It cannot answer *"is
> every single element correct, purposeful, and polished?"* because nothing enumerates the full
> surface. **The Atlas is that layer.** A script (the Cartographer) keeps the registry mechanically
> honest; a session (the Perfectionist, `loops/perfectionist.md`) drives every entry to `perfected`.

## The goal (and the gauge)

**Done = every entry `perfected` AND fresh at the current trunk.** The convergence gauge is:

```
npm run qa:atlas:status        #  PERFECTED-fresh X / total Y (Z%)  + per-area breakdown
```

The loop never ends: staleness re-queues work. When a file behind a `perfected` entry changes after
that entry was blessed, the entry becomes **stale** and re-enters the queue — perfection has to be
re-proven against the code that now ships. So the gauge is a *living* number, not a one-time 100%.

## The one law that shapes everything

Same split as the whole station (`qa/QA_STATION.md` §"the one rule"): **scripts detect + write the
registry/ledger; sessions judge + notify.** Mechanically, that means the Cartographer script writes
ONLY the harvested/mechanical fields and NEVER a field a human decided:

| Field | Owner | Written by |
| --- | --- | --- |
| `id` `kind` `area` | script (identity) | minted once at skeleton time, stable forever |
| `name` `selector` `state` | **script** | refreshed every sweep from the live/static harvest |
| `firstSeen` `lastSeen` | **script** | `firstSeen` set once; `lastSeen` bumped every sweep |
| `missing` | **script** | set `true` when a swept-kind entry is no longer found; cleared on re-sight |
| `purpose` `promise` | **session** | the human writes what it's FOR + its observable contract |
| `wiring` `coverage` | **session** | the human traces the seam + records the guarding test/journey |
| `status` (beyond `unmapped`) | **session** | only the session promotes `mapped→audited→perfected` |
| `auditedAt` | **session** | `{sha,date}` the session stamps at audit/perfect time |
| `findings` | **session** | ledger fingerprints the session filed against this entry |

**The script never overwrites session judgment.** A re-sweep that re-finds an existing entry updates
its `lastSeen` (and refreshes `name`/`selector`) and touches NOTHING else. This is verified in
`test/qa-cartographer.test.js` (the "session-owned fields UNTOUCHED" assertions) and live (a seeded
`perfected` entry survives a re-sweep byte-for-byte except `lastSeen`).

## The entry schema

One shard file per area: `qa/atlas/areas/<area>.json`, shape:

```json
{ "area": "<name>", "updatedAt": "<iso>", "entries": [ … ] }
```

entries are **stable-sorted by `id`** (clean diffs). Each entry:

```json
{
  "id": "ui/system/bb-recruit",
  "kind": "ui | command | route | event | state | prop",
  "area": "crew | work | build | system | world | commands | routes | events | props",
  "name": "human label",
  "selector": "#bb-recruit",          // ui kind only
  "state": "crew-recruit",             // ui kind only: the FIRST shoot state it was seen in
  "purpose": "",                       // SESSION: what this is FOR, one honest sentence
  "promise": "",                       // SESSION: the observable contract (what a user can verify)
  "wiring": { "files": [], "events": [] },     // SESSION: the seam (emitter → store → renderer)
  "coverage": [],                      // SESSION: [{"kind":"journey|audit|test|golden|shoot","ref":"J1"}]
  "status": "unmapped",                // unmapped → mapped → audited → perfected
  "auditedAt": null,                   // SESSION: {"sha":"…","date":"iso"} at audit/perfect time
  "findings": [],                      // SESSION: ledger fingerprints filed against this entry
  "firstSeen": "iso", "lastSeen": "iso",
  "missing": false                     // SCRIPT: true when a sweep no longer finds it
}
```

A malformed entry is **rejected loudly on load** — the Cartographer names the file + id and throws
(`[atlas] malformed entry areas/system.json#… : bad kind …`). A corrupt shard never silently passes.

## The status lifecycle

```
unmapped ──► mapped ──► audited ──► perfected ──► (stale, on file change) ──► back into the queue
   ▲                                                                              │
   └──────────────────────  (a NEW element appears) ── skeleton ─────────────────┘
```

- **unmapped** — the script found the element and minted a skeleton. Nobody has judged it yet. This
  is the ONLY status the script ever writes. The registry itself is the work queue; unmapped entries
  are **not** ledger findings (we don't flood the ledger with the backlog — only *vanished* entries file).
- **mapped** — a session filled `purpose` + `promise` + `wiring` (it understands the seam).
- **audited** — a session PROVED the promise holds in the live app (DOM round-trip / `window.__world`
  read) and stamped `auditedAt`.
- **perfected** — the entry passed the full 7-point rubric in `loops/perfectionist.md` (purpose stated ·
  promise written · works live-proven · truthful · discoverable · polished · covered by a machine
  assertion). Only now does `status` become `perfected`.
- **stale** — *derived, not stored.* At `--status` time, a `perfected`/`audited` entry with a recorded
  `auditedAt.sha` and non-empty `wiring.files` is checked with `git log --oneline <sha>..HEAD -- <files>`;
  any output means the code moved and the entry is **stale** — re-queued until re-proven.
- **missing** — the script swept and did not find a previously-known entry (of a kind this sweep covered).
  It flips `missing:true` and files ONE P2 `dead-entry` ledger finding. A human reconciles: retire the
  entry (surface really removed) or route the regression that hid it.

## The staleness law

**Perfection expires when the code behind it changes.** An entry is only ever counted toward the
`PERFECTED-fresh` gauge if BOTH: `status === perfected` AND `git` reports no commits touching its
`wiring.files` since `auditedAt.sha`. This is why filling `wiring.files` accurately is not optional —
an entry with no wired files can never go stale, which means it can never be *trusted* to still be
perfect. An honest `wiring` is the price of a `perfected` stamp.

## Concurrency — one session, one area

Many Perfectionist sessions may run at once, but **one session claims one area at a time** (the
sharded-registry design exists precisely so two sessions editing *different* areas never conflict).
This is the concurrent-sessions law from `docs/MISTAKES.md` #4 (two sessions on the same queue item
caused silent data loss). Before working an area, a session records its claim in `docs/NEXT.md`'s
**Atlas** section as `IN PROGRESS — <lane>`, and releases it when the area's batch is committed. Never
work an area another session has claimed; never edit two areas' shards in one session.

## The crew

| Role | Kind | Launch | Cadence | Writes |
| --- | --- | --- | --- | --- |
| **Cartographer** | script | `npm run qa:atlas` | weekly + after big merge waves | shards (skeletons/`lastSeen`/`missing`), `ATLAS.md`, STATUS row, `dead-entry` findings |
| **Perfectionist** | session | `/loop` per `loops/perfectionist.md` | self-paced | the session-owned judgment fields; routes fixes to feature lanes |

- `npm run qa:atlas` — full sweep (static enumeration + live DOM walk on ports 8920/9320).
- `npm run qa:atlas:static` — static half only (slash commands, routes, events, states; no Chrome).
- `npm run qa:atlas:status` — the gauge + regenerate `ATLAS.md` + refresh the STATUS row.

Evidence for every sweep lands in `.uiatlas/sweep-report.json` (counts per kind/area, new/missing
lists, states walked, elements per state). The Cartographer **never notifies** — a red sweep (a
`dead-entry` or a BLOCKED) surfaces only through the ledger + the Overseer digest, exactly like every
other crew script. No-fake-green: a sweep that cannot run files a P0 BLOCKED finding and exits 2.
