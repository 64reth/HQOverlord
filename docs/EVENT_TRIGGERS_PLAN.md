# Event triggers — the WATCHER design

Status: **design only, nothing built.** Written 2026-07-28 alongside the `connectors.list` and
`voice_generate` slices, which shipped in the same pass.

## Where this came from

Asked what StarNet lacks as a harness, an agent answered: *"StarNet has scheduled routines, but I don't
have general webhook/event triggers like 'wake up when an email arrives, a GitHub issue opens, or a Stripe
payment fails.'"* That gap is real. The proposed **shape** was wrong, and the difference matters enough to
write down before anyone builds it.

## Why NOT an inbound webhook endpoint

The obvious build is `POST /api/hooks/<id>` with a signing secret. It is architecturally wrong here:

- **The sidecar is loopback-only, by threat model.** `sidecar/apiauth.js` pins `Host` to
  `127.0.0.1 / localhost / ::1` (the DNS-rebinding defense), allow-lists the `Origin`, and requires a
  per-launch token on every `/api/*` route. GitHub cannot reach any of that. A webhook endpoint means
  either punching the app onto the public internet or shipping a tunnel — a new always-on network surface
  and a new class of remote attack against a single-user local app.
- **The one webhook-shaped thing we ship already avoids webhooks.** Telegram is a **long poll**:
  `sidecar/channels/telegram.transport.js` calls `getUpdates`, and `connect` even calls `deleteWebhook`
  first, because a webhook set by some earlier tutorial makes every poll fail with 409. Slack ingress is
  the same story. Nothing in StarNet has ever accepted an unsolicited inbound request, and that is a
  property worth keeping.
- **Local-first is the product.** A trigger that only works while a tunnel is up is a trigger that lies.

## The right shape: a WATCHER

A watcher is a routine whose firing condition is *"this source changed"* instead of *"the clock says so"*.
It is polled from the machine we already trust, over the credentials we already hold.

```
watcher = {
  probe:  a CHEAP, model-free read of a source        (one tool call, no model turn)
  cursor: what we had last time                       (the missing primitive — see below)
  fire:   the existing routine run, only on CHANGE    (the only leg that spends money)
}
```

### The law that makes it affordable

**A poll must never spend a model turn; only a change may.** The probe leg is a direct call — a connector
tool, a `web_request` with a stored key, an `fs` stat — executed by the driver, with no agent loop
attached. A five-minute watcher that finds nothing costs a request, not a run. This is the difference
between a feature and a bill, and it is the one thing to get right first: the moment a probe is "just ask
the agent to check", every watcher becomes a paid run every tick, forever.

### The primitive that is actually missing

Not the scheduler — `sidecar/cron-driver.js` already ticks, holds a pid-stamped on-disk lock
(`cron-lock.js`, the one store that cannot assume single ownership), respects the E-STOP/arm state, and
runs a job through the same path as `POST /api/cron/run`. Not the job record either: `cron-store.js` jobs
already carry a `meta` bag that is explicitly additive.

What is missing is a **durable cursor** — "I have already seen issue #42 / message id 7731 / etag W/abc".
Without it a watcher either re-fires forever or dedupes in the agent's prose, which is not dedupe. The
cursor must survive a sidecar restart (backend law: any state a user expects to persist round-trips a
restart, and you test the round-trip before claiming it works), and it belongs beside the job, not inside
an agent's memory — an agent's notebook is the wrong trust class for "did this already happen".

### Sketch, in this codebase's terms

- `schedule.kind: 'watch'` alongside `once | interval | cron`. The tick cadence stays a normal interval;
  what changes is that firing is conditional. `cron.js` owns schedule math, `cron-store.js` owns the
  record — that split holds.
- `watch: { probe: {...}, cursorPath: '<jsonpath-ish>', cursor: <last seen>, lastProbeAt, lastChangeAt,
  consecutiveFailures }` on the job record, additive like `meta`.
- Probe sources, in the order they are worth building:
  1. **Connector tool call** — `connectors.list` already tells the agent (and the Commander) which
     connectors exist; GitHub issues, Notion pages, Linear tickets are one `manager.call(id, tool, args)`.
  2. **`web_request` with a stored service key** — covers Stripe, Printify, Etsy and everything else in
     `servicekeys-catalog.js` that ships no MCP server. Reuses the existing per-key autonomy grant, which
     already distinguishes *watched sessions only* from unattended spend — a watcher is unattended by
     definition, so an un-granted key must simply refuse to be watched.
  3. **Filesystem** — mtime/size under a blessed project root, through the existing path-trust guard.
- The fire leg is unchanged: the routine runs exactly as a scheduled one does, with the change summary as
  its context.

### Failure modes to design against, not discover

- **The source that says everything is new.** A probe whose cursor never matches fires every tick. Needs a
  circuit breaker: N consecutive fires with no cursor advance pauses the watcher and says why.
- **The flapping source.** Up/down/up across ticks. Needs the change to be *the cursor advancing*, not
  *the response differing*.
- **The dead credential.** A 401 must pause the watcher with an honest state, never silently stop firing —
  a watcher that quietly stops is worse than one that never started, because the Commander believes it is
  watching.
- **Probe cost drift.** A probe that grows into a paginated crawl is a model turn by another name. Cap it.

### Done means

The Commander sets a watcher on a real source, the source changes, and a routine fires within one tick
with the change in its context — observed live, plus a sidecar restart in the middle proving the cursor
survived. Not "the unit tests pass".

## Not in scope here

Full desktop control (`sidecar/tools/builtin/computer.js` is an inert contract with no driver) and
disposable container sandboxes are separate, larger builds. Persistent signed-in browsing is **already
shipped** — `browserProfileLeaseFor()` in `sidecar/index.js` leases a durable station profile per run,
with the tmpdir profile as the ephemeral fallback when another run holds the lease.
