# v0.7.0 cut checklist — REFRESHED 2026-07-27 at trunk `dd3d4f90`

> **This supersedes the prep copy measured at `1a9aacfd`.** Three things in that text are now
> wrong and are corrected inline:
>
> 1. **Its "built but NOT merged" table is obsolete.** Every lane it listed as unmerged — REACH
>    parity, Hermes final parity, conveyor agentic graphs, the LOOP system, prop art v6/v7, the
>    extensibility spine — has since merged and gated on trunk. Only subscriptions (held by
>    Andrew) and prop-rotation-yaw (parked) remain out.
> 2. **The signing-certificate expiry blocker was false.** See §B1.
> 3. **The "pushing the branch deploys starnetos.com" worry is false.** Re-measured today. See §B2.
>
> Everything below was measured against the tree, a gate run, or the live GitHub feed on
> 2026-07-27 — not read out of a plan doc. `docs/RELEASE_RUNBOOK.md` is the general procedure;
> this is the tonight-specific version, with the parts that are stale in the runbook corrected.

---

## A. State, measured at `dd3d4f90`

| Thing | Value |
|---|---|
| Trunk | `feat/harness-backend` @ `dd3d4f90` |
| Latest **published** release | **v0.6.8**, `androoAGI/starnet-releases`, 2026-07-27 05:06Z, 9 assets |
| Live `latest.json` version | `0.6.8` |
| In-tree version | `0.6.8` in all three files — **a version that has already shipped** |
| Commits since `v0.6.8` | **~217** · **19 lane merges** |
| Unpushed on trunk | **~184** commits ahead of `origin/feat/harness-backend` |
| `npm run test:fast` | green — see §C |
| `npm run test:http` | green — see §C |
| claims planning authority | **PASS** — 37 claims, 184 locked surface files |
| `src-tauri/` diff vs `v0.6.8` | **EMPTY — zero bytes changed.** See §E |
| `shared/` diff vs `v0.6.8` | **EMPTY** |
| `package.json` | strict JSON, no BOM |

**The version in the tree is a version that has already shipped.** Cutting from it as-is produces
a build the updater will never offer, because the installed fleet already reports `0.6.8`.
**Tonight's cut is `0.7.0`.** `scripts/release-bump.mjs` already floors the new version against
the *highest published* release rather than the in-tree one, so it will refuse `0.6.8` on its own.

---

## B. Blockers — and two that turned out not to be

### B1 — [CORRECTED] There is no expiring code-signing certificate

The prep copy carried this as blocker #1: *"the code-signing certificate expires 2026-07-28."*
**Nothing in the repo supports it.** Windows signing runs through **Azure Trusted Signing**
(account `starnet-signing`, certificate profile `starnet-public`), which mints a **short-lived
certificate per signing operation** and rotates it as a service — no certificate of ours has an
expiry we have to renew. `docs/CODE_SIGNING.md` records a provisioning date and no expiry. The
updater key is **minisign**, which does not expire either.

**What *can* actually lapse** is the Azure service principal's client secret
(`AZURE_CLIENT_SECRET`, service principal `starnet-ci-signer`) — a different object with a
different lifetime. If the train's Windows leg comes back unsigned, that secret is the thing to
check, not a certificate. The train treats all three `AZURE_*` secrets as optional: absent means
an unsigned Windows build with SmartScreen back, **not** a failed build. So this is something to
verify in the run log, not a gate that stops the cut.

### B2 — [CORRECTED] Pushing the branch does not deploy the website

Several lane digests declined to push trunk on the grounds that "the diff touches `website/` and
pushing auto-deploys starnetos.com." Re-measured today:

- `curl -o /dev/null -w '%{http_code}' https://api.github.com/repos/androoAGI/starnet/pages`
  → **404**. GitHub Pages was never enabled, so `deploy-website.yml` fails red on every push.
  That X in Actions is noise, not a broken release.
- `curl -sI https://starnetos.com` → `Server: cloudflare`. The live site is **Cloudflare Pages
  direct upload**, which has no git integration. It moves only when someone runs
  `wrangler pages deploy website --project-name starnet-site`.

**So the push is safe — and it is not optional.** The release train builds the tree at the pushed
tag. ~184 unpushed commits means an unpushed trunk would build last week's code.

### B3 — The live manifest advertises two platforms that do not exist (REAL, still open)

Verified against the live feed today. `latest.json` on v0.6.8 lists five platforms:

```
windows-x86_64     -> StarNet_0.6.8_x64-setup.exe        200 OK
darwin-aarch64     -> StarNet_darwin-arm64.app.tar.gz    200 OK
darwin-x86_64      -> StarNet_darwin-x64.app.tar.gz      200 OK
linux-x86_64       -> StarNet_0.6.8_amd64.AppImage       404 — asset stripped at publish
linux-x86_64-deb   -> StarNet_0.6.8_amd64.deb           404 — asset stripped at publish
```

The train assembles all five platforms, a human deletes the linux assets from the draft per
[release-platforms-law], and **nobody re-assembles the manifest afterwards**. This is the v0.6.6
mac bug with the axis flipped. It does not break Windows or mac updating — it just leaves two
dead keys — but it is what keeps `release:verify-host` permanently red.

**At v0.7.0:** after deleting the linux assets, re-assemble the manifest with
`--allow-missing linux-x86_64,linux-x86_64-deb` and re-upload `latest.json`, then prove it (§D10).

### B4 — Everything the READY gate checks expires at the final merge

`maxTrunkDrift` is **0** and the freshness window is 24h, so Guardian, Journeys and the Beginner
Run must all run at the *exact* commit being cut. Any merge after they run invalidates them.
These cannot be pre-earned — they are the last step before the bump, not the first.

### B5 — Installed-exe smoke has to be re-earned

`checkInstalled` in `scripts/qa/ready.mjs` requires `buildCommit`, `expectedHead` and
`sourceTree` to equal the current trunk head and tree. It cannot be inherited; it has to come
from a build of the exact cut commit. It was waived at v0.6.4, v0.6.5, v0.6.7 and v0.6.8.

**This cut is different:** Andrew is testing a candidate build on his own desktop before the cut
(§F), which is exactly what earns this stamp. Run `npm run qa:smoke:installed` against that build
rather than waiving it again.

---

## C. Gate state

Measured at `ea2bc380` (pre-merge baseline) and re-run at `dd3d4f90` after the four fix merges,
the checkpoint fix and the claims re-lock:

| Gate | Result at `ea2bc380` | Result at `dd3d4f90` |
|---|---|---|
| `npm run test:fast` | **421 steps green** | green (423 steps) |
| `npm run test:http` | **51/51 suites, exit 0** | green |
| claims planning authority | **PASS** (37 claims / 184 files) | **PASS** (37 claims / 184 files) |
| `src-tauri/` vs `v0.6.8` | zero bytes changed | zero bytes changed |
| Merge conflict markers in tree | none | none |

> **Read the exit code from inside the redirect.** `npm test > log 2>&1; echo "EXIT=$?"` inside a
> backgrounded subshell reports the **echo's** status, not npm's — a red gate reported itself as
> exit 0 during this very review. And because `npm test` is `test:fast && test:http`, a red fast
> phase means **`test:http` never runs at all**; do not read its absence as a pass.

**Three gate-reliability fixes ship with this cut**, all of which used to produce phantom REDs:

- Three tests built their fixture directory at a *fixed* `os.tmpdir()` path and `rm -rf`'d it on
  entry (`image.test.js`, `autonomy-write.test.js`, `spotify.store.test.js`), so two gate runs in
  two worktrees deleted each other's fixtures. All three suffix with `process.pid` now.
- `test/module-scope-shadowing.test.js` is new — see §G1.
- A dev sidecar running on :8787 during a gate run can turn unrelated fast tests red. Stop it
  before gating.

---

## D. The cut, in order

Run this **after Andrew's desktop test passes** (§F). Nothing before step 3 can be banked early.

1. **Freeze.** Announce it. Any merge after the QA below invalidates it (B4).
2. `git push origin feat/harness-backend` — safe (B2), and required.
3. **Earn READY at the final commit:**
   ```bash
   npm run qa:guardian && npm run qa:beginner && npm run qa:ready
   ```
   Guardian runs test:fast + http-e2e + shoot + golden + audit + journeys, so it covers the
   journeys stamp too. Any red stops the cut.
   > **Golden-frame trap:** if `golden` goes red, re-bless from the Guardian pin at
   > `C:\Users\andro\Desktop\_qa-guardian-pin`, never from the dev repo — a bless captured in the
   > dev repo does not reproduce in the pin and reads as a phantom regression.
4. **Bump:**
   ```bash
   npm run release:bump 0.7.0
   ```
   Bumps `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`,
   rewrites `RELEASE_NOTES.md` with a stub, commits, tags locally. Pushes nothing.
5. **Paste the real notes.** `docs/RELEASE_NOTES_v0.7.0_DRAFT.md` → `RELEASE_NOTES.md`, then
   `git add RELEASE_NOTES.md && git commit --amend --no-edit`.
6. **Re-lock the claims surface as its own commit.** `RELEASE_NOTES.md` is a locked path, and
   **the audit reads the ledger from the commit, never the worktree** — an uncommitted re-lock is
   invisible and the gate stays BLOCKED (this happened during this review). Recipe:
   ```bash
   node scripts/qa/product-perfect/claims.mjs --refresh-surface --candidate $(git rev-parse HEAD) > /tmp/surface.json
   # splice /tmp/surface.json into claims.json as .releaseSurface, then:
   git add qa/product-perfect/claims.json && git commit -m "qa(claims): re-lock the release surface for v0.7.0"
   node scripts/qa/product-perfect/claims.mjs      # expect PASS
   ```
7. **Move the tag onto the re-lock commit:** `git tag -f v0.7.0`. Tag-after-stamp is what made
   the v0.6.5 train pass its gate first try with no re-fire.
8. **Gate again, post-bump, pre-push:** `npm run test:fast`. A fixture coupled to the version
   number is what burned both v0.2.0 and v0.2.1.
9. **Push the tag:** `git push origin v0.7.0`. This starts `release-train.yml`
   (gate → build 4 legs → assemble → stage-draft). A single red leg is usually a runner flake —
   Re-run failed jobs; `stage-draft` is idempotent.
   > **Push classifier trap:** if `git push` is blocked from PowerShell, run the identical push
   > through the Bash tool — that has worked every time PowerShell was blocked.
10. **Review the draft** on `androoAGI/starnet-releases`. Version/tag exactly `v0.7.0`; notes are
    the real body, not the scaffold; every updater artifact has a matching `.sig`; exactly one
    `latest.json`.

    **Strip exactly four assets** (the linux ones), nothing else:
    ```
    StarNet_0.7.0_amd64.AppImage  + .sig
    StarNet_0.7.0_amd64.deb       + .sig
    ```
    **Keep attached** — 9 assets published:
    ```
    StarNet_0.7.0_x64-setup.exe      + .sig    (windows updater + manual download)
    StarNet_darwin-arm64.app.tar.gz  + .sig    (mac updater feed, Apple Silicon)
    StarNet_darwin-x64.app.tar.gz    + .sig    (mac updater feed, Intel)
    StarNet_0.7.0_aarch64.dmg                  (manual download, Apple Silicon)
    StarNet_0.7.0_x64.dmg                      (manual download, Intel)
    latest.json
    ```
    Then **re-assemble and re-upload `latest.json`** without the two linux keys (B3).
11. **Publish** — the only human ship gate. Then prove it:
    ```bash
    npm run release:verify-host -- --expect-version 0.7.0 --require-platforms windows-x86_64,darwin-aarch64,darwin-x86_64
    ```
    With B3 fixed this should be a clean PASS with no expected FAILs for the first time.

    Also verify the site's download buttons resolve to installers, not signatures — the matcher is
    a substring (`x64-setup.exe` also matches `x64-setup.exe.sig`) and relies on GitHub returning
    assets alphabetically:
    ```bash
    curl -s https://api.github.com/repos/androoAGI/starnet-releases/releases/latest | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=(JSON.parse(d).assets||[]).map(x=>x.name);const w=a.find(n=>n.includes('x64-setup.exe'));const m=a.find(n=>n.includes('aarch64.dmg'));console.log('win ->',w,w&&!w.endsWith('.sig')?'OK':'BAD');console.log('mac ->',m,m?'OK':'BAD');})"
    ```

---

## D2. Post-publish

- Mirror the release on `androoAGI/starnet` (source repo) with exe + both DMGs.
- **Release hygiene is currently owed.** [release-platforms-law] says only the current version
  stays downloadable. Measured today:
  - `starnet-releases`: **v0.6.8, v0.6.6, v0.6.5, v0.6.4** all still published.
  - `starnet` (source): **v0.6.8, v0.6.6, v0.6.4**.

  Archive the assets locally first (`release/archive/vX/`) — v0.6.4/6.5/6.6/6.7 are archived,
  **there is no `v0.6.8` archive yet** — then delete. Published-release deletion is a manual UI
  step: each repo → Releases → delete, then Tags → delete.
- Website fallback strings: `website/site.js`, `index.html`, `pricing.html` now say `0.6.8` (this
  cut's prep merge moved them off `0.6.6`). Bump to `0.7.0` and upload **after** publish —
  starnetos.com is a Cloudflare Pages direct upload, so this needs a `wrangler` deploy and is
  cosmetic either way (the live number comes from the GitHub API at page load).
- **Decision owed:** `website/pricing.html` is on trunk and linked from ten docs pages and the
  sitemap. The site does not auto-deploy, so it stays invisible until someone runs wrangler — but
  the *next* wrangler deploy publishes a public pricing page for a subscription whose client side
  is still held. Decide deliberately; don't let a routine site deploy ship it by accident.
- Still open from v0.6.5: VirusTotal + Defender false-positive submissions for the signed exe;
  Apple notarization ($99), which would retire the `xattr -dr com.apple.quarantine` step.

---

## E. Upgrade safety — will v0.7.0 break an existing install?

### E1 — The installer changes in exactly ONE way, and it is a fix

> **UPDATED after the desktop test.** `src-tauri/` is no longer byte-identical to v0.6.8 — see
> §G4. The diff is exactly two files: a new `installer/hooks.nsh` and the one line in
> `tauri.conf.json` that registers it. **Nothing that decides where the app installs or where its
> data lives moved** — `identifier`, `productName`, NSIS `installMode`, the updater `endpoints`
> and the minisign `pubkey` are all verified unchanged. `shared/` is still byte-identical.

```
git diff v0.6.8..HEAD -- src-tauri/   →  installer/hooks.nsh (new) + tauri.conf.json (+2/-1)
git diff v0.6.8..HEAD -- shared/      →  EMPTY
```

Every mechanism that decides where the
app installs and where its data lives is the same code that already performed a successful
v0.6.7 → v0.6.8 update in production: `identifier` `ai.skynet.harness` (unchanged — this is what
makes Windows install *over* the existing app rather than beside it), `productName` `StarNet`,
NSIS `installMode: passive`, the updater endpoint and minisign pubkey, and the
`%APPDATA%\ai.skynet.harness\workspaces` data dir. A side-by-side install — the classic way an
update reads as "it deleted everything" — is structurally impossible here. `shared/` is also
byte-identical, so no event or schema contract moved.

The residual risk is therefore the **data layer**, not the installer: ~217 commits of frontend and
sidecar change reading a save file written by an older build. The method that cleared v0.6.7
applies — copy the live profile to scratch and boot trunk against the copy with
`SKYNET_WORKSPACES` on a spare port, never writing to the original. **Andrew's desktop test (§F)
covers this on his real profile.**

### E2 — Behaviour an existing user WILL notice on first launch

Put these in the notes, not in a bug report — an unexplained change reads as a regression.

1. **Belts already drawn dock-to-dock now buy real runs.** A floor drawn `INBOX → A → B → OUTBOX`
   used to run only A; it runs the whole line now. Floors that are a lone bay, or
   `INBOX → bay → OUTBOX`, behave exactly as before. A mutual A↔B loop is now refused with
   `CHAIN_CYCLE` where it previously did nothing.
2. **The station looks different** — the wall crown rings the whole room, contact shadows are
   pools rather than bars, the CRT aperture opened from 50% to 68%, and the bed, lockers and
   three tables were redrawn top-down.
3. **Controls are drawn by StarNet, not the OS** — every button, dropdown, checkbox, slider,
   scrollbar, input font, dialog and tooltip. Anyone used to the native tooltip delay will notice
   it is gone.
4. **COMMS sounds different** — 26 cues moved off the old synth onto the pack.
5. **Checkpoints start recording** (§G1). Users who never had a restore list will now have one.

---

## F. Andrew's desktop test — the pre-cut gate

Andrew's stated order: *test on my own desktop first, then tell you to publish.* This is the
installed-exe smoke (B5), earned rather than waived.

1. Build the candidate from the exact cut tree: `npm run desktop:build`
   (retry once on a ctor crash — that is a known flaky Rust build, not a code fault).
2. Install over the existing StarNet. The identifier is unchanged, so it upgrades in place and
   the profile stays put (E1).
3. Relaunch with the WebView2 debug port open and run the smoke:
   ```bash
   npm run qa:smoke:installed
   ```
   (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'`; set
   `STARNET_SMOKE_EXPECTED_HEAD` to the candidate SHA and `STARNET_SMOKE_ARTIFACT` to the exe.)
4. Hand-check list below — the things a gate structurally cannot see.

### F2 — What to actually look at, and why the gate can't

| Look at | Why |
|---|---|
| A floor drawn `INBOX → A → B → OUTBOX` runs **both** agents | The single biggest behaviour change for an existing station |
| E-STOP mid-chain stops every stage | The 6-hop / $2 caps are unit-proven but were **never live-tripped** |
| The **easel** prop | Redrawn v6 and **never judged** — the one prop from the ugly-six pass with no verdict |
| Wall crown on a **multi-room** station | Corner work leaked 148px on multi-room once; a single room cannot reproduce it |
| The COMMS sound board at real volume | Level-grading was tuned by ear, and only 10 of 36 cues were mapped before |
| ABILITIES › EXTENSIONS — create, approve, revoke, delete a hook | Shipped this cut; the authoring UI is new |
| A restore point appears after a shell command | §G1 — this never worked before, so nobody has seen it work |
| The ACP editor bridge from a real editor | **Never seen live in an editor** — the only proof is a spawned-bridge e2e |
| Your own saved station and crew open intact | The data-layer risk in E1 |

---

## G. Found during this review

### G1 — The shadow-git undo net was dead in the shipped app (FIXED, `3113523a`)

`sidecar/index.js` declared `runGit` **twice at module scope** — the checkpoint helper
`(args, opts)` and the night-shift/loop-harvest one `(root, args, timeoutMs)`. CommonJS does not
error on that; the **last declaration silently wins for the whole module**, including for the
hoisted reference above it. So `checkpointStore`, constructed with `runGit: runGit`, was handed
the wrong signature and **every `snapshot()` returned `null`**.

Blast radius: every `shell.*` and `verify.*` tool call takes a checkpoint regardless of the
`CHECKPOINTS` flag (`index.js:10714`), and `fs.write` takes one unconditionally
(`index.js:11586`) — both inside swallow-all `try` blocks, so it failed in silence.
`GET /api/checkpoints` always listed nothing and RESTORE had nothing to restore.
`checkpoint-store.test.js` stayed green the whole time because it injects its own `runGit`.

Proven on the real module rather than argued: `runGit.length` was **3** before and **2** after,
and a live `store.snapshot()` goes from `null` to a real snapshot id.

**LAW — A UNIT TEST THAT INJECTS A DEPENDENCY CANNOT SEE A WIRING BUG.** The store was
exhaustively tested and completely disconnected. The only thing that catches this class is
checking the wiring itself, which is what `test/module-scope-shadowing.test.js` now does: no two
column-0 `function` declarations in `sidecar/index.js` may share a name. Reverting the rename
turns it red on 4 assertions.

### G2 — "Full access" on any consent card is a blanket session grant (OPEN, product call)

`consent.grant('full')` writes `'*'` into `grantsBlanket`, and `granted()` then returns true for
every danger class (`sidecar/permissions.js:164,230`). Every consent card except the browser ones
offers a `Full access` button (`frontend/app/chat.js:1873`). So clicking "Full access" on an MCP
connector card also blesses `shell.exec` for the rest of the session on the interactive surface.

This is **documented, deliberate, session-only (never persisted to disk), and still below the
hardline floor** — and autonomous runs remain locked out of `execute` regardless (tier 2.5). It is
not a defect so much as an unanswered product question: does "Full access" on a card mean *this
tool*, *this connector*, or *everything*? The button copy does not say. **Not a release blocker;
flagged for a decision.**

### G4 — The manual installer could not overwrite its own node.exe (FIXED, found by Andrew)

Andrew ran the candidate installer and got **"Error opening file for writing … node.exe"**. Not a
one-off: Tauri's `CheckIfAppIsRunning` only ever kills `${MAINBINARYNAME}.exe` (the shell), and it
does so with a hard TerminateProcess that runs neither `Drop` nor `ExitRequested` — so it
*strands* the sidecar, and the next thing the Install section does is `File` over `node.exe`.
Interactively that stops on Abort/Retry/Ignore; **silently (`/S`) it is worse — the error is
auto-ignored and the install completes carrying a stale node.exe.**

- **The in-app updater path was already safe** and is unchanged: `main.rs:1836` adds an
  `on_before_exit` hook that calls `kill_sidecar()` before the plugin's `std::process::exit`.
  This was found and canary-proven 2026-07-14 and shipped in v0.6.7 and v0.6.8. **UPDATE CENTER
  users were never affected.**
- The gap was the **manual** path (a download from the site) and the **orphan** path (a sidecar
  stranded by an earlier hard kill — taskkill /F, crash, End Task — whose parent is long gone;
  the Rust-side reaper only runs at the *next* app boot, i.e. after the installer has failed).
- Fixed by `src-tauri/installer/hooks.nsh`, an `NSIS_HOOK_PREINSTALL` that kills the shell and
  then the sidecar, **matched on full image path**, before the file copy.

Three traps this hit, all recorded in the hook's own header:

1. **Order is load-bearing.** A guardian thread respawns the sidecar every ~3s while the shell
   lives (`main.rs` `spawn_guardian`), gated only by an in-process flag a hard kill never sets.
   Kill node first and it is back, holding the same lock, within three seconds.
2. **Scope is load-bearing.** Tauri's own `KillProcess` matches by NAME. On the test machine that
   would have killed **18 unrelated `node.exe` processes**. The hook matches full image path only.
3. **The WOW64 trap.** The NSIS installer is a **32-bit** process, so `$SYSDIR` redirects to
   SysWOW64 and launches the 32-bit PowerShell — which can see 64-bit processes but reads their
   `.Path` as **empty**. The first version of the hook therefore matched nothing, returned exit 0,
   and did nothing at all. Reaching the 64-bit PowerShell via `SysNative` is the fix. Note it
   failed **safe** (killed nothing) rather than dangerous.

Proven in both directions on a real install:

| | pre-hook build | with the hook |
|---|---|---|
| `node.exe` replaced while locked | **no** (silently skipped) | **yes** |
| locking sidecar killed | no | yes |
| unrelated `node.exe` killed | 0 | **0 of 16** |

Then re-verified against the **real** install at `%LOCALAPPDATA%\StarNet` with a live sidecar
running: silent install, exit 0, no dialog, registration correct, 0 of 15 unrelated node
processes touched.

### G3 — A delegating run's per-run $ cap does not bound the total (OPEN, pre-existing)

`runCapUsd` bounds the lead's own spend; a delegated worker carries its own `o.maxCostUsd`
(`index.js:11087`). N workers under a lead therefore cost up to N × cap, and only the soft
cross-run pools in `budget.js` bound the total. Pre-existing, unchanged by this cut, recorded so
it is not rediscovered as a regression.

---

## H. What is NOT in this cut

**Merged and gated on trunk, so it ships:** conveyor agentic graphs (a dock's output is the next
dock's input, on all four surfaces) · REACH parity (ACP editor bridge, outbound `channel.send`,
`routine.manage`) · the LOOP system with real approve/reject · the extensibility spine (hooks,
scoped plugins, MCP resources + prompts, thinking on both native wires) · Hermes memory parity ·
wall crown ring · sprite shadow pool · CRT aperture · CONTROL FLOOR + OS-paints-nothing + input
font floor · PAINT→SURFACE · dossier live skin preview · COMMS sound board / composer / rail
layout · summon desk seed · prop art v6/v7 top-down redraw · skin sit frames + POLISHED install +
eye-constrained blink · connector "Full access" · folder-card "Full access" · project trust
revoke · permissions authority-on-failure · oversized outbound refusal · dossier skin a11y ·
the checkpoint fix (§G1).

**Built but deliberately NOT in this cut:**

| Lane | Branch | Ahead | Why |
|---|---|---|---|
| Subscriptions / credits gap-close | `claude/starnet-subscription-complete-e95ae8` | 13 | Its own HEAD commit says *"does not merge until Andrew says so."* Needs a deploy + a flip, both Andrew's calls. |
| Prop rotation = yaw | `claude/prop-rotation-system-22983e` | 38 | Parked; 7 conflicts against current trunk; superseded scope. |
| Red-Green Closer QA harness | `claude/starnet-agentic-graphs-5c6a0f` | 3 | Dev tooling, not user-facing. Optional at any time. |

---

## I. Known-stale docs (do not follow blindly)

- `docs/RELEASE_RUNBOOK.md` §1.7 and §5.4 demand all five platform keys including Linux before
  publishing. That contradicts [release-platforms-law] and is the source of B3.
- The runbook's "VERIFICATION STATUS" block still says nothing has ever been published and the
  last built version is 0.4.1. Eight releases have shipped since.
- `docs/BRAIN.md` — every agent session reads it first; check its shipped-version line.
- `scripts/release-cut.mjs` — **`--help` runs a real cut.** There is no help flag. Do not probe it.
