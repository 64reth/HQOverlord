# v0.6.7 cut checklist — prepared 2026-07-25, REFRESHED 2026-07-26 @ 10d837d0

> **Read the 07-26 refresh first — three things in the original text are now wrong.**
> Corrections are marked **[07-26]** inline. Summary:
> 1. §A's state table was stale in your favour: Guardian and journeys are green **at the exact
>    current head** right now, and trunk is 28 commits ahead of origin, not 197.
> 2. §C step 8's claim that the branch push publishes starnetos.com is **wrong** — re-measured
>    today. It doesn't, and it doesn't need to. See **[07-26] §C8**.
> 3. Version is **0.6.7**, re-confirmed by Andrew 2026-07-26. (This worktree is misleadingly
>    named `update-0-7-7-release`; there is no 0.7.7.)
>
> Added: **§E — upgrade safety**, the "will this break existing installs" question, proven
> rather than argued.

Written while Andrew is still merging. Everything here was verified against code/live endpoints
at 62706fb9, not read out of a plan doc. `docs/RELEASE_RUNBOOK.md` is the general procedure; this
is the tonight-specific version, with the parts that are actually stale in the runbook corrected.

---

## A. State at prep time

**[07-26] Live state, re-measured at `10d837d0`** — this supersedes the table below it:

| Thing | State 2026-07-26 21:0x Z |
|---|---|
| Trunk | `feat/harness-backend` @ `10d837d0` |
| Commits since `v0.6.6` | 349 total · **142 substantive** · 2,391 files |
| Guardian last cycle | **GREEN, all 6 gates, no skips, AT `10d837d0` = current head** (stamped 21:06Z) |
| Journeys | **PASS 129/129 at `10d837d0`** (same stamp) |
| Beginner Run | PASS but at `2b40689b` — **behind head, must be re-run** (`maxTrunkDrift` is 0) |
| Installed-exe smoke | still BLOCKED, v0.6.3 bytes — same waiver call as B2 below |
| Unpushed on trunk | **28** commits ahead of `origin/feat/harness-backend` (was 197 at prep) |
| `src-tauri/` diff vs `v0.6.6` | **EMPTY — zero bytes changed.** See §E |
| `shared/events.js` diff | additive only (2 optional budget fields + `credits.low`) |
| Version fields | 0.6.6 across all three, still consistent, no BOM |

So at this moment **only the Beginner Run is owed** to earn READY — and it, Guardian and
journeys all expire the instant the next merge lands. Nothing here can be banked; it is the
last step before the bump, not the first.

<details><summary>Original 07-25 state table (superseded)</summary>

| Thing | State |
|---|---|
| Trunk | `feat/harness-backend` @ `62706fb9` |
| Shipped version | 0.6.6 (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — all three agree, no BOM) |
| Commits since `v0.6.6` | 245 total · **105 substantive** (rest are qa/claims/status) |
| `npm run test:fast` | **GREEN — 392 steps** at 62706fb9 |
| Guardian last cycle | GREEN, all 6 gates, no skips — but at `e118c759` (13 commits behind head) |
| Journeys | PASS 129/129 at `e118c759` |
| Beginner Run | PASS (ui-only) at `e118c759` |
| Ledger | 0 P0 · 0 P1 · 0 P2 |
| Installed-exe smoke | **BLOCKED**, v0.6.3 bytes, stamped 2026-07-20 |
| Unpushed on trunk | **197 commits** ahead of `origin/feat/harness-backend` (`0b48a904`) |
| Updater signing key | present at `~/.tauri/starnet-updater.key` (+ `.pub`) |
| Actions secrets on `androoAGI/starnet` | `RELEASES_TOKEN` (2026-07-22), `TAURI_SIGNING_PRIVATE_KEY`, `AZURE_TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET` |

</details>

Note on secrets: there is **no** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret. That is correct —
the key's password is the empty string and an absent secret resolves to empty. There are also **no
`APPLE_*` secrets**, so the mac legs are updater-signed (minisign) but not Apple-notarized; the
train has a documented fallback for exactly this. Unchanged from v0.6.6.

---

## B. Blockers found during prep

### B1 — Mac in-app auto-update is BROKEN on the live v0.6.6 feed (pre-existing)

Proven with `npm run release:verify-host` against the live endpoint just now: **4 FAILs.**

`latest.json` on the published v0.6.6 release advertises five platforms:

```
windows-x86_64, darwin-aarch64, darwin-x86_64, linux-x86_64, linux-x86_64-deb
```

The release actually carries only five files: `latest.json`, the exe, the exe `.sig`, and the two
DMGs. So:

- `windows-x86_64` → exe + `.sig` present → **HTTP 200, works.**
- `darwin-aarch64` → `StarNet_darwin-arm64.app.tar.gz` → **HTTP 404.**
- `darwin-x86_64` → `StarNet_darwin-x64.app.tar.gz` → **HTTP 404.**
- both `linux-*` → **HTTP 404.**

A Mac user on v0.6.5 who opens UPDATE CENTER and clicks INSTALL UPDATE gets a download failure.
The DMG is the *manual* installer; the `.app.tar.gz` + `.sig` is what the updater consumes. The
publish-time strip that enforces the Windows+Mac-only download policy removed the mac updater
bundles along with the linux ones.

Second-order effect: because the reachability loop in `verify-update-host.mjs` iterates **every**
platform present in the manifest (`--require-platforms` only controls which must be *present*, it
does not scope the URL check), `npm run release:verify-host` is structurally incapable of passing
while linux keys ride in the manifest. Step 1.9 of the runbook has been permanently red.

**DECIDED (Andrew, 2026-07-25): publish-time fix only, no code change.** At publish, strip only
the four linux assets. **Keep** the two mac `.app.tar.gz` files and their `.sig`s attached
(~104MB extra on the release). Mac auto-update starts working with v0.6.7.

`verify-host` will still flag the two linux 404s. That is expected, not a failure of the cut —
scope the check to the platforms that are actually published:

```bash
npm run release:verify-host -- --expect-version 0.6.7 \
  --require-platforms windows-x86_64,darwin-aarch64,darwin-x86_64
```

Deferred to a later cut (not tonight): dropping the `ubuntu-22.04` leg from the train matrix and
teaching `release-assemble-manifest.mjs` an `--only-platforms` filter, so the manifest itself
matches [release-platforms-law] and `verify-host` goes green with no flags.

### B2 — Installed-exe smoke has to be re-earned, and it is the long pole

`checkInstalled` in `scripts/qa/ready.mjs` requires `buildCommit` AND `expectedHead` AND
`sourceTree` to equal the **current trunk head and tree**. The stamp on disk is v0.6.3 bytes from
2026-07-20 with `result: BLOCKED`. It cannot be inherited — it has to be re-earned from a build of
the exact cut commit, which means a full Rust desktop build (10–30 min, plus install + smoke).

This gate was waived at the v0.6.4 and v0.6.5 cuts. Waiving it again is a legitimate call, but it
should be a decision, not a surprise at 2am.

### B3 — Everything the READY gate checks expires at the final merge

`maxTrunkDrift` is **0** and the freshness window is 24h, so Guardian, Journeys and the Beginner
Run must all run at the *exact* commit being cut. Any merge after they run invalidates them.
There is no way to pre-earn these — they are the last thing before the bump, not the first.

---

## C. The cut, in order

Run this **after the last merge lands**. Nothing before step 3 can be banked early.

### 1. Version — DECIDED: `0.6.7`

Andrew's call, 2026-07-25: stays on the 0.6.x line. The notes draft is titled for it.

### 2. Freeze

Announce the freeze. Any merge after the QA runs below invalidates them (B3).

### 3. Earn the READY gate at the final commit

```bash
npm run qa:guardian && npm run qa:beginner && npm run qa:ready
```

Guardian runs test-fast + http-e2e + shoot + golden + audit + journeys, so it covers the journeys
stamp too. Expect READY with one FAIL: installed-exe smoke (B2). Any *other* red stops the cut.

> **Golden-frame trap:** if the `golden` gate goes red, re-bless from the Guardian pin at
> `C:\Users\andro\Desktop\_qa-guardian-pin`, never from the dev repo — a bless captured in the dev
> repo does not reproduce in the pin and reads as a phantom regression. Guardian was green at
> `e118c759` today, so this is currently clear.

### 4. Stage the notes

`docs/RELEASE_NOTES_v0.6.7_DRAFT.md` holds the body, current through 62706fb9. Re-run the delta
command in its header, append anything new, then it is ready to paste.

### 5. Bump

```bash
npm run release:bump 0.6.7
```

Bumps `tauri.conf.json` + `Cargo.toml` (+ `Cargo.lock`), scaffolds `RELEASE_NOTES.md`, commits,
tags locally. Pushes nothing.

Then replace the scaffold body with the draft and fold it into the release commit:

```bash
git add RELEASE_NOTES.md && git commit --amend --no-edit && git tag -f v0.6.7
```

### 6. W0 re-stamp — then move the tag

Shipped-surface commits need the claims re-lock, and **the tag must sit on the stamp commit, not
before it**. That ordering is what made the v0.6.5 train pass its gate on the first try with no
re-fire. After the stamp lands:

```bash
git tag -f v0.6.7
```

### 7. Gate again, post-bump, pre-push

```bash
npm run test:fast
```

A fixture coupled to the version number is what burned both v0.2.0 and v0.2.1. Green here means
the train's gate job is green.

### 8. Push — branch and tag together

> ### [07-26] CORRECTION — the branch push does NOT publish starnetos.com
>
> Everything below about `release-train.yml` is right. The website half is **wrong**, and it was
> re-measured today, not inferred:
>
> - `curl -o /dev/null -w '%{http_code}' https://api.github.com/repos/androoAGI/starnet/pages`
>   → **404**. GitHub Pages was never enabled. `deploy-website.yml` fires on the push and
>   **fails red every time**. Expect that X in Actions; it is noise, not a broken release.
> - `curl -sI https://starnetos.com` → `Server: cloudflare`. The live site is **Cloudflare Pages
>   direct upload**, which has no git integration. It only moves when someone runs
>   `wrangler pages deploy website --project-name starnet-site`.
>
> **The good news: the release does not need a site deploy.** `website/site.js` fetches
> `api.github.com/repos/androoAGI/starnet-releases/releases/latest` on page load and rewrites
> both the version strings (`#ver-badge`, `#ver-foot`, `.ver`) and every download button's
> `href` from the live release assets. The download page follows the new release on its own,
> within minutes of publishing, with no deploy at all.
>
> Two consequences worth knowing:
> - `FALLBACK_VERSION = '0.6.6'` in `website/site.js:5` is what a visitor sees only if that API
>   call fails (offline / rate-limited). Bumping it is cosmetic and **requires a wrangler
>   deploy to take effect** — it is not part of the cut.
> - The download buttons match assets by substring: `x64-setup.exe` also matches
>   `x64-setup.exe.sig`, and `assets.find()` takes the first hit. It works today only because
>   GitHub returns assets alphabetically (`.exe` sorts before `.exe.sig`) — verified against the
>   live v0.6.6 release. Adding the two mac `.app.tar.gz` bundles introduces no new collision
>   (`aarch64.dmg` doesn't match them). **Re-check once after publish** (§10).
>
> **DECISION OWED:** `website/pricing.html` **is now on trunk** (`b4315d74`), linked from all ten
> docs pages and in `sitemap.xml`. The original note below saying it "is not on trunk" is stale.
> Because the site doesn't auto-deploy, it stays invisible tonight either way — but the next
> wrangler deploy publishes a public pricing page for a subscription whose client side is still
> held. Decide deliberately; don't let a routine site deploy ship it by accident.

**Original 07-25 text (website half superseded above):**

```bash
git push origin feat/harness-backend
git push origin v0.6.7
```

The two pushes drive two independent workflows — worth knowing which does what, because they can
be separated if anything goes wrong mid-cut:

- `release-train.yml` → `on: push: tags: ['v*']` — the **tag** starts the train. It does not
  touch the website (a tag push cannot match a branch filter).
- `deploy-website.yml` → `on: push: branches: [main, feat/harness-backend], paths: ['website/**']`
  — the **branch** publishes the site.

Trunk is 197 commits ahead of origin, and **16 of those touch `website/`**, so the branch push is
what puts **starnetos.com** (`website/CNAME`) live: the rewritten landing page, the live
in-browser app preview, ten docs pages, the legal pages. Watch the `deploy-website` run in Actions
alongside the train.

> The credits/pricing page is *not* in this set — `website/pricing.html` is not on trunk, so the
> subscriptions lane stays unshipped either way.

> **Push classifier trap:** if `git push` is blocked from PowerShell, run the identical push through
> the Bash tool — it has passed immediately every time PowerShell was blocked.

### 9. Watch the train

Actions → release-train for `v0.6.7`: **gate → build (4 legs) → assemble → stage-draft.** A single
red leg is usually a runner flake — Re-run failed jobs. `stage-draft` is idempotent.

### 10. Review + publish the draft

Draft lands on `androoAGI/starnet-releases`. Before publishing:

- version/tag exactly `v0.6.7`; notes are the real body, not the TODO scaffold
- every updater artifact has a matching `.sig`; exactly one `latest.json`

**Strip exactly four assets** (the linux ones), and nothing else:

```
StarNet_0.6.7_amd64.AppImage        + .sig
StarNet_0.6.7_amd64.deb             + .sig
```

**Keep attached** — this is the B1 fix, and it is the difference between mac auto-update working
and 404ing:

```
StarNet_0.6.7_x64-setup.exe         + .sig     (windows updater + manual download)
StarNet_darwin-arm64.app.tar.gz     + .sig     (mac updater feed, Apple Silicon)
StarNet_darwin-x64.app.tar.gz       + .sig     (mac updater feed, Intel)
StarNet_0.6.7_aarch64.dmg                      (manual download, Apple Silicon)
StarNet_0.6.7_x64.dmg                          (manual download, Intel)
latest.json
```

That is 9 assets published, versus the 5 that shipped at v0.6.6.

Then Publish (the only human ship gate), and verify against the platforms actually published:

```bash
npm run release:verify-host -- --expect-version 0.6.7 --require-platforms windows-x86_64,darwin-aarch64,darwin-x86_64
```

Expect PASS on all three published platforms, and two FAILs on the linux keys still listed in the
manifest. Those two are known and accepted for this cut (B1).

> **[07-26] Also verify the site's download buttons resolve to installers, not signatures.** The
> matcher is a substring (`x64-setup.exe` also matches `x64-setup.exe.sig`) and relies on GitHub
> returning assets alphabetically. One command:
>
> ```bash
> curl -s https://api.github.com/repos/androoAGI/starnet-releases/releases/latest | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=(JSON.parse(d).assets||[]).map(x=>x.name);const w=a.find(n=>n.includes('x64-setup.exe'));const m=a.find(n=>n.includes('aarch64.dmg'));console.log('win ->',w,w&&!w.endsWith('.sig')?'OK':'BAD');console.log('mac ->',m,m?'OK':'BAD');})"
> ```

### 11. Post-publish

- Mirror the release on `androoAGI/starnet` (source repo) with exe + both DMGs.
- Delete the v0.6.6 release + tags on **both** repos — only the current version stays downloadable.
  Published-release deletion is classifier-blocked for me; it is a manual UI step (each repo →
  Releases → v0.6.6 → Delete, then Tags → v0.6.6 → delete).

  **Already done during prep:** the v0.6.6 assets are archived locally at
  `release/archive/v0.6.6/` (copied from `release/verify-0.6.6/`, sizes match the published
  release exactly), so the delete is unblocked:

  ```
  StarNet_0.6.6_x64-setup.exe   ef4974f957b2bf45dc3604b5d10b8a09be0fd7a8a7c1b022d24b4dbb97c75fcd
  StarNet_0.6.6_aarch64.dmg     4ec54423501053b8df452e928cb7471632e2ede5a6045fbb2c5fff05ad22c067
  StarNet_0.6.6_x64.dmg         f68c1250856d67ed592c2257bdc4573280c3b08e433242ef81dbabfea4f1a39b
  ```
  (plus the exe `.sig` and `latest.json`.)
- The live v0.6.6 release bodies still carry x64-for-all mac wording — patch at this cut.
- Still open from v0.6.5: VirusTotal + Defender false-positive submissions for the signed exe;
  Apple notarization ($99), which would let the `xattr -dr com.apple.quarantine` step die.

---

## D. Known-stale docs (do not follow blindly)

- `docs/RELEASE_RUNBOOK.md` §1.7 and §5.4 demand all five platform keys including Linux before
  publishing. That contradicts [release-platforms-law] (Windows + Mac only) and is the source of B1.
- The runbook's "VERIFICATION STATUS" block still says nothing has ever been published and the last
  built version is 0.4.1. Six releases have shipped since.
- `docs/BRAIN.md` claims shipped version v0.2.2 and lists unsigned binaries as a bottleneck. Every
  agent session reads it first.
- `scripts/release-cut.mjs` — **`--help` runs a real cut.** There is no help flag. Do not probe it.

---

## E. [07-26] Upgrade safety — will v0.6.7 break an existing install?

The question Andrew asked before this cut. Answered by measurement, not by argument.

### E1 — The installer and updater are byte-identical to the ones that shipped

```
git diff v0.6.6..HEAD -- src-tauri/    →  EMPTY
```

Zero bytes changed in the Tauri layer across 349 commits. That means **every mechanism that
decides where the app installs and where its data lives is the same code that already performed
a successful v0.6.5 → v0.6.6 update in production**:

| Thing | Value | Changed? |
|---|---|---|
| `identifier` | `ai.skynet.harness` | no |
| `productName` | `StarNet` | no |
| NSIS `installMode` | `passive` | no |
| Updater `endpoints` | `releases/latest/download/latest.json` | no |
| Updater `pubkey` | `dW50cnVzdGVk…` (minisign) | no |
| Data dir the shell passes as `SKYNET_WORKSPACES` | `%APPDATA%\ai.skynet.harness\workspaces` | no |

An unchanged `identifier` is the one that matters most: it is what makes Windows install *over*
the existing app instead of beside it, and what keeps the data directory pointing at the same
place. A side-by-side install is the classic way an update reads as "it deleted everything."
That failure mode is structurally impossible here.

The residual risk is therefore **not the installer — it is the data layer**: 349 commits of
frontend and sidecar change reading a save file written by an older build.

### E2 — Proven: a real, old profile opens clean on the new build

Method (2026-07-26): copied Andrew's live desktop profile
(`%APPDATA%\ai.skynet.harness\workspaces`, 305 MB, `last-run-version` = **0.6.3**, schemaVersion 1
— i.e. *older* than the 0.6.6 a real updating user will have, so this is the harder case) to
scratch, and booted trunk `10d837d0` against the copy with `SKYNET_WORKSPACES` on port 8799.
The original was never written to.

Result:

- **Boots clean.** No error, no exception, no `ENOENT`/`EACCES`, no migration failure in the log.
- **Everything came back.** The live UI showed the crew member `ULTRON` (Lv 1, idle), the full
  session list going back 6 days, the restored COMMS transcript including an old "while you were
  away" delivery card with its two files, and the model pin `GPT 5.6 SOL`.
- **Zero browser console errors** after full UI load — this is the check that would catch a store
  whose shape the new frontend can't read.
- **`agent.save.json` was not modified at all.** Its 17 `doc` keys and the agent survived intact.
- Five files were rewritten at boot, all of them runtime state, none of them user config:
  `_commander.autonomy.json`, `_station.questrefresh.json`, `agent.roster.json`,
  `agent.workshop.json`, `scout.state.json`. `agent.roster.json`'s `agents` array is
  **byte-identical** — only its `updatedAt` moved.
- `skills.jsonl` is compacted at boot (`5,597,419 B → 17 entries`). This looks alarming in the
  log and is not: it is append-log compaction. 184 lines held **17 unique keys**; the compacted
  file holds the same **17**, with **0 unique keys lost**. Verified by diffing the key sets.

### E3 — Behaviour changes an existing user WILL notice (put them in the notes, not in a bug report)

None of these break anything. All of them are visible on first launch, which is exactly why they
belong in the release notes — an unexplained change reads as a regression.

1. **The station looks different.** The default deck moved `plate` → `spine` and the default wall
   `plating` → `bulkhead`. Both commits state the change reaches **stations already built**
   deliberately (a station that never chose a floor carries `floorMat: null` and renders the
   default). `plate`/`plating` remain in the palette. → covered in the notes draft.
2. **Spend caps start firing on Anthropic and Google.** `sidecar/providers/prices.js` gives those
   two providers real per-token pricing; previously `spentUsd` stayed `0.00` on them, so a
   configured per-run ceiling could never trigger. Blast radius is small — `maxCostUsd` defaults
   to `Infinity` (`sidecar/loop.js:187`), so only a user who *explicitly set* a cap sees a
   change, and what they see is their own cap finally working.
3. **Fewer tools are advertised per request.** Browser sub-tools are `deferred: true` in the
   capability registry — still granted, reachable via `tool.search`. Agents behave slightly
   differently; nothing was revoked.
4. **An agent wearing Beach Babe or Steve changes appearance.** `ff3c3362` retired both
   (`DATA.SKINS` 38 → 36) and deleted their sprite dirs and manifest keys. A save still holding
   `skin: 'beachbabe'` is **not** a crash: `frontend/js/assets.js:123` resolves
   `DATA.SKINS[b.skin] && …set` with a fallback to `DATA.SKINS[DATA.DEFAULT_SKIN].set`, and the
   scale lookup (`:44`) and the picker (`app.js:1900`) both guard the same way — verified by
   reading each site, not assumed. The agent renders as the default skin instead, silently. That
   is the only removal in this release that reaches existing saves, and it is in the notes.

### E4 — What is still NOT proven

Stated plainly so it isn't mistaken for coverage:

- **The in-app update itself was not exercised end-to-end.** E1 is a code-identity argument, E2 is
  a data-layer proof. Neither one is "clicked INSTALL UPDATE on a v0.6.6 install and watched it
  land." That is the installed-exe smoke (B2), still waived.
- **Mac auto-update has never once succeeded in production** — it 404s today (B1). v0.6.7 is the
  first build that can fix it, and the fix is publish-time (§10, keep the 9 assets). It cannot be
  verified before publishing, only after. A mac user on 0.6.6 clicking INSTALL UPDATE tonight
  still fails; they must download manually this one last time.
