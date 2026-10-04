# Public-flip checklist — source repo `androoAGI/starnet`

Status as of 2026-07-20 (this lane). The repo was renamed `skynet-harness` → **`starnet`**
while private, and the account was renamed `nonfungiblefunyuns-ship-it` → **`androoAGI`**;
GitHub redirects both old URL forms (repo + owner) and old clones keep working.

> **Username-rename caveats:** repo redirects survive only until someone registers the freed
> `nonfungiblefunyuns-ship-it` username — installed v0.6.3 apps update through the OLD owner
> URL until they've taken one update (the next release bakes the `androoAGI` endpoint), so
> don't dawdle on the next release, and consider re-registering the old username as a parking
> account if GitHub allows. GitHub does NOT redirect Pages sites — relevant when the website
> lane deploys. Description, homepage,
and topics are set. `starnet-releases` (already public) has description/topics set and a staged
landing-page README (see step 6).

Work through these **in order**, then flip.

## 1. Land your remaining changes

Merge whatever small changes are still in flight. The flip should happen from a trunk you
consider release-shaped.

## 2. Prune merged remote branches — ✅ DONE 2026-07-21

49 fully-merged remote branches deleted (content lives in trunk; local branches untouched).
Remote now holds trunk + the ~20 unmerged branches listed below.

<details><summary>Original guidance (kept for reference)</summary>

The remote currently has ~70 branches; **50 are fully merged into trunk** — their content is
entirely contained in `feat/harness-backend`, so deleting the remote refs loses nothing and
makes the public branch list readable. From any checkout:

```bash
for b in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin \
    | grep -vE 'origin/(feat/harness-backend|HEAD)$'); do
  git merge-base --is-ancestor "$b" origin/feat/harness-backend \
    && git push origin --delete "${b#origin/}"
done
```

**Do NOT delete the ~20 unmerged branches** (`agent/api-hardening`, `agent/beginner-ux`,
`agent/camera`, `agent/chat-resize`, `agent/cleanup`, `agent/cortex-hermes-plus`,
`agent/cortex-memory`, `agent/cron-staylive`, `agent/design-system`,
`agent/floor-routes-inapp`, `agent/orchestrator-control`, `agent/parity-finish`,
`agent/quick-model-selector`, `agent/recruit-fix`, `agent/recruitment-bay`, `agent/ship-rail`,
`agent/threejs-skill`, `agent/tutorial`, `agent/ui-polish`, `agent/workpipe-b`) — for all but
`agent/parity-finish` the remote is the **only copy** of that work. If you want them out of
public view, fetch them into local branches first (`git fetch origin <name>:archive/<name>`),
verify the local ref, then delete the remote ref.

</details>

## 3. Secret-scan ALL refs — ✅ DONE 2026-07-21 (CLEAN)

Gitleaks 8.30.1 (official binary, sha256-verified against the release manifest) run with
`--log-opts="--all"` over every ref including the 20 unmerged remote branches:
**3131 commits scanned, 52.14 MB, no leaks found** (21-fingerprint reviewed baseline in
`.gitleaksignore`). This closes the "clean full-history Gitleaks result" the
open-source-readiness lane left open.

<details><summary>Original guidance (kept for reference)</summary>

`npm run security:secrets` (and CI `secret-history.yml`) run `gitleaks git .`, which scans the
history of the **checked-out branch only**. The unmerged remote branches above have never been
scanned and become public at flip. Before flipping, with Gitleaks installed
(<https://github.com/gitleaks/gitleaks/releases>), run once with every ref included:

```bash
git fetch origin
gitleaks git . --no-banner --redact --log-opts="--all"
```

Review anything new (the reviewed baseline lives in `.gitleaksignore`, currently 25 pinned
fingerprints). A clean captured run of this is the "clean full-history Gitleaks result" the
open-source-readiness lane left open.

</details>

## 4. Social preview image (manual — no API for this)

Repo **Settings → General → Social preview → Upload an image** and upload
`.github/media/og-card.png` (1200×630, made for exactly this). Do it on both `starnet` and
`starnet-releases`. This is what the repo link shows when shared on X/Discord/etc.

## 5. Decide the default branch (optional)

The default branch is `feat/harness-backend`. It works, but reads as a WIP feature branch to
outsiders. If you want a conventional face, GitHub → Settings → Branches → rename to `main`
(GitHub auto-redirects and retargets open PRs; every agent checkout then needs
`git fetch origin && git remote set-head origin -a` and the worktree docs/protocol updated —
that churn is why this lane did NOT do it). Leaving it as-is is fine for an early release.

## 6. Push the staged starnet-releases landing page

A commit with the proper download README + wordmark asset is staged locally (this lane's
scratchpad clone). Push it, or recreate: README with installer table, first-run-warning
walkthrough, updater note; `assets/starnet-logo-glow.png` alongside.

## 7. Re-mint the RELEASES_TOKEN Actions secret

Still open from the launch runbook: the CI publish token (Actions secret on the `starnet`
source repo) must be re-minted so the release train can upload to `starnet-releases`.

## 8. Commit attribution (decided 2026-07-21)

New commits carry Andrew as the **only** author — no `Co-Authored-By` agent trailers (law in
the local protocol files). 2471 of ~3411 historical commits still carry the trailer; erasing
those requires a full history rewrite (every SHA changes → breaks the W0 claims sourceCommit
pins, release provenance stamps, the 20 unmerged branches, and all 9 tags). Deliberately NOT
done pre-flip; if wanted later, it's its own carefully-sequenced lane after the unmerged
branches land or are archived. Historical trailers are only visible when opening individual
old commits.

## 9. Flip

Repo **Settings → General → Danger Zone → Change visibility → Public.** Immediately after:

- Confirm `https://github.com/androoAGI/starnet` renders the README with both
  images (they live in-repo under `.github/media/`, so they render as soon as the repo is
  visible).
- Confirm the badges resolve (the download badge already works — it reads `starnet-releases`).
- Enable **Private vulnerability reporting** (Settings → Security) so the
  `security/advisories/new` link in SECURITY.md and the issue-template config works.
- Check the Issues tab shows the templates and the security contact link.

## Already done by this lane (2026-07-20)

- GitHub: repo renamed to `starnet`, description + homepage + topics set (both repos).
- README.md rebuilt (wordmark hero, station render, badges, feature table, download table,
  OpenClaw/the reference harness importer section).
- All breaking `skynet-harness` references updated: `package.json` (repository/homepage/bugs),
  `CONTRIBUTING.md` clone lines, `.github/ISSUE_TEMPLATE/config.yml` advisory link,
  `test/opensource-readiness.test.js` URL assertion, living docs
  (BRAIN/NEXT/RELEASE_RUNBOOK/LAUNCH_RUNBOOK/STARNET_UPDATES/LAUNCH_CHECKLIST/DOWNLOAD_PAGE/
  MAC_UPDATE_TEST/CODE_MAP/DECISIONS). Dated audit docs keep their historical wording.
- `publish.sh` (obsolete private-repo bootstrap) removed.
- Local `origin` remote repointed at the new URL.
- Marketing assets committed under `.github/media/` (wordmark, station render, OG card).
- Public hygiene: ALL Claude/agent-factory tooling is untracked + gitignored — `.claude/`
  (skills + launch.json), `CLAUDE.md`, `AGENTS.md`. They stay on disk as local-only files
  (the factory still runs on them); `gen-trees\new-agent-tree.ps1` copies them into new
  worktrees, and existing worktrees restore them from the integration tree after syncing
  trunk (git deletes tracked copies on that sync). `design/` mockups dropped (unreferenced).
  Kept public: `loops/` + `dev/` (referenced by QA scripts/tests), `qa/`, labeled
  design-history docs. Optional later: scrub personal paths from ~60 dated plan/audit docs.

Deliberately unchanged (locked decisions): internal `skynet.*` storage keys, `SKYNET_*` env
fallbacks, `ai.skynet.harness` bundle/keychain id, and the `skynet-desktop` binary name — all
back-compat aliases; renaming the binary risks the auto-update path and waits for a tested
update-path lane.
