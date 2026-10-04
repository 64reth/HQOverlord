# SWEEP · release — installer, updater, signing, desktop shell, migration

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `release`.
**Rank 10 of 10** by hunt priority, but a defect here is the only kind that can break every
existing install at once — so nothing merges out of this lane without a machine artifact.

## What you own

`src-tauri/` · `scripts/release-*.mjs` · `verify-update-host.mjs` · `minisign-verify.mjs` ·
`update-canary.mjs` · `prepare-node.mjs` · `scripts/t0`–`t5` runners ·
`scripts/qa/installed-*.mjs` · `sync-website-app.mjs`

## The governing law of this lane

**No release claim without a machine artifact.** A missing toolchain (Rust/Cargo) is BLOCKED,
never passed. If you cannot produce the artifact, say so — an honest BLOCKED is a good outcome
here and a false green is the worst outcome in the entire repo.

## The failure states to walk

1. **Run the ladder:** `t0:clean-install`, `t1:signing`, `t2:state-safety`,
   `t3:release-smoke`, `t4:update-delivery`, `t5:public-distribution`. Anything that cannot run
   is BLOCKED with the exact env requirement named.
2. **Upgrade with real state.** Install an OLD version, use it enough to have sessions, keys,
   projects and a station, THEN update. Nothing may be lost, and nothing may be silently
   migrated wrong. A clean-install update proves almost nothing.
3. **Interrupt the update.** Kill it mid-download, mid-verify, mid-install. Go offline halfway.
   Corrupt the downloaded artifact. Each must fail closed and leave a working install.
4. **A bad signature must be refused,** loudly, and the refusal must be readable by a
   non-technical user.
5. **The desktop shell bundles the frontend directly** — a CDP attach on the packaged app is
   the ONLY install proof. A browser against `:8787` proves nothing about what shipped.
6. **The per-release manifest fix is PER-RELEASE.** It does not carry forward. Confirm it is
   applied for the cut you are testing.
7. **Platform law: WINDOWS + MAC ONLY, never Linux.** Only the current version may be
   downloadable — check what is actually reachable, not what the docs say.
8. **The generated website mirror.** `npm run sync:website` — the mirror is generated and is
   gated in `test:fast`, but it **fails LATE**. Verify it is in sync before you finish, not
   after.

## Two traps

- **`RELEASE_NOTES.md` on trunk is the LAST cut's copy**, and `release:bump` overwrites it.
- **A branch push deploys NOTHING** — starnetos.com is a Cloudflare direct-upload. Do not infer
  a deploy from a push.

## Done means

Every rung of the ladder either GREEN with its artifact path recorded, or BLOCKED with the exact
missing toolchain named. No rung silently skipped.
