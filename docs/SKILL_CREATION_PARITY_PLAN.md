# Skill-creation parity plan — 7/10 → 9/10

## STATUS 2026-07-28 — BUILT AND PROVEN (P0 1-4 + P1 5-6), branch `claude/starnet-hermesagent-comparison-e1a29b`

Commits: `237f8762` (enforcement) · `0f87fb9d` (claims re-lock) · `4040fb27` (dead-preload fix +
live proofs). NOT pushed, NOT merged — Andrew pushes.

Proof: `test/skills.gate.test.js` 80 assertions (units) · `test/skills.gate.http.test.js` 31
(real booted host over sockets) · `test/skills.gate.prompt.e2e.test.js` 22 (the bytes that reach
the provider, mock upstream). `test:fast` green, 424 steps. Every guard was reverted one at a time
and watched go red before being trusted. Claims re-locked; the only W0 problem left is the
pre-existing installed-exe smoke stamp, which nothing here touches.

**Three things this plan got wrong, corrected by grounding:**
1. Support-file CONTENT was already capped and redacted (`red(e.content, supportFileMax)`, 64k).
   Item 5 shrank to a file-COUNT + package-BYTES cap.
2. The plan missed a second hole in the same area: `package.js hydrate()` reads `SKILL.md` back off
   disk and OVERRIDES the stored body, so a package edited after the scan laundered content past
   the guard. `gate.verify()` re-digests at the delivery seam to catch it — and legacy records
   (written before the guard existed, carrying no verdict at all) are live-scanned there too.
3. Mapping the Commander's own writes to the `trusted` tier made an unapprovable dead end once
   verdicts were enforced. Human-authored content now has its own `user` tier that ASKS.

**Found in passing and fixed (not in this plan):** the `/skill` preload path had never worked.
`sidecar/index.js` read the bare identifier `preloadSkills` inside `runOnce` — handleRun's local —
so it threw ReferenceError every run and the enclosing catch swallowed it silently. Invisible to
every unit test; visible the moment a test asserted on the provider's system prompt.

Still open from this doc: **P2 item 7** (a user-authored "New skill" composer in the panel). The
WITHHELD card + Approve button shipped, so the panel's claims-re-lock cost is already paid.

---


Scope: the **creation/authoring** surface only (`sidecar/skillstore.js`,
`sidecar/skills/{package,guard,runtime}.js`, `sidecar/tools/builtin/skills.js`, the
review/curator forks in `sidecar/index.js`). Distribution (a hub / third-party install /
`skills.sh`-style taps) is a **separate lane** — see the Recipes-marketplace direction; nothing
here depends on it.

Reference side: `C:\Users\andro\hermes-ref\tools\skill_manager_tool.py` (1559 LOC),
`agent/background_review.py`, `tools/skills_guard.py`.

Grading rule used below: the gap to 9 is **enforcement**, not features. StarNet already has the
action set, package dirs, secret redaction on write, `requires`/`platforms` gating, per-agent
caps, and archive-instead-of-delete. What it lacks is code that says *no*.

---

## P0 — the four that carry the 2 points

### 1. The guard verdict is dead code — enforce it
**Today:** `skillstore.js:186-192` scans every persisted skill and stamps
`entry.guardAction` (`allow` / `ask` / `block` via `skills/guard.js` TRUST tiers).
`grep guardAction` across `sidecar/**` + `frontend/app/**` returns **zero consumers**. A
self-written skill whose body contains `rm -rf ~` or `curl … $API_KEY` is stamped `block` and
then indexed and injected anyway.

**Build:**
- `skills/runtime.js` `composeIndex()` — filter `guardAction === 'block'` the same way
  `isLive()` filters archived, and return the count as `blocked` alongside `omitted`.
- `tools/builtin/skills.js` `skill.view` — refuse the body of a blocked skill with the finding
  categories (not the raw matched text), so the model learns why.
- `guardAction === 'ask'` → route through the existing consent card path (the same
  `permission.prompt` seam the connector/approval work uses). One decision per skill id,
  remembered by the broker, invalidated when the body changes (hash the body into the record —
  same shape as `plugins-allowed.json` keying by code hash).
- Surface the verdict in the SKILLS panel card so a withheld skill is visible, not silent.

**Proof:** `test/skills.guardgate.test.js` — write a skill with `rm -rf ~`, assert it is absent
from `composeIndex()` and refused by `skill.view`; assert the body edit re-arms an `ask`.
Then live: two runs, before/after, on one seeded dangerous skill.

### 2. `pinned` is a prompt rule — make it code
**Today:** the only thing protecting a pinned skill is a bullet in
`skillcurator.js buildPrompt()` ("Never modify pinned skills"). `skillstore.js:331` archives a
pinned skill without complaint; `edit`/`patch`/`write_file` overwrite one too. Hermes has
`_pinned_guard()` called from every mutating action.

**Build:** one guard at the top of `manage()` (and inside `write()` when it resolves to an
existing pinned entry): refuse `archive`/`delete`/`edit`/`patch`/`write_file`/`remove_file` with
`{ ok:false, error:'"<name>" is pinned — unpin it first' }`. Exempt only an explicit
user-surface call (`createdBy === 'user'` **and** `e.force === true`), so the SKILLS panel can
still override deliberately.

**Proof:** extend `test/skills.library.test.js` — pin, then attempt all six mutations, assert
refusal and that the stored `updatedAt` did not move.

### 3. Read-before-write ledger for the review/curator forks
**Today:** `runBackgroundSkillReview()` (`index.js:1795`) and the curator (`:1885`) hand the
fork `skill.write/manage/list/view` with nothing tying a *patch* to a *read*. The fork can
rewrite an existing skill from transcript inference alone. Hermes blocks exactly this
(`mark_background_review_skill_read` → `_background_review_read_before_write_guard`).

**Build:** the seam already exists — `capCtx` carries `skillReview: true` and
`createdBy: 'background-review' | 'curator'`, and `makeSkillTools` already accepts an `onView`
hook. Keep a per-`runId` `Set` of viewed skill ids; in `skill.manage`, when
`ctx.createdBy` is one of those two forks and the action mutates an **existing** skill, refuse
unless its id is in the set, with a message that names `skill.view`. `create` stays free.

**Proof:** `test/skills.review.guard.test.js` — dispatch `skill.manage{action:'patch'}` with a
review ctx and no prior view → refused; after a `skill.view` → allowed. Ledger keyed by runId,
so a second pass starts empty.

### 4. A curator archive must name where the content went
**Today:** `manage()` collapses `delete` into `archive` (good — nothing is destroyed) but records
no lineage, so a consolidation pass that archives four siblings leaves no trail from sibling to
umbrella. Hermes requires `absorbed_into` on a curator delete
(`_curator_consolidation_delete_guard`).

**Build:** when `ctx.createdBy === 'curator'`, `archive` requires `absorbedInto` naming a
**live, non-archived** skill of the same agent; stamp it on the entry, mirror it into the package
frontmatter (`package.js frontmatter()`, next to `source_run_id`), and show it on the archived
card ("merged into X"). Non-curator archives stay unchanged.

**Proof:** curator ctx archive without `absorbedInto` → refused; with a bogus target → refused;
with a live target → stamped, and `restore` still works.

---

## P1 — polish (holds the 9 under load, not needed to reach it)

5. **Support-file caps.** The body is capped and redacted (`red(body, bodyMax)`), but
   `write_file` content has no size cap and no per-skill file count cap — a review fork can
   inflate a package until the package mirror dominates the workspace. Add both
   (mirror Hermes `_validate_content_size`), and redact support-file content on the same path as
   the body.
6. **Symlink / path-redirect check.** `package.js supportPath()` blocks `..`, absolute paths,
   drive letters and control bytes, but not a **symlinked skill directory** — resolve the target
   under the package root before any write and refuse a redirect (Hermes `_is_path_redirect`).

## P2 — product, not parity

7. **User-authored create in the SKILLS panel.** `POST /api/agent-skills/manage` already accepts
   `action:'create'`; the panel only offers *edit* on an existing card
   (`stationui.js:2581 editAgentSkill`). Add a "New skill" composer (name / summary / category /
   body). Costs a **claims re-lock** because `frontend/app/stationui.js` is a release-surface
   file — budget that, don't discover it at the gate.

---

## Order, cost, and how it lands

One lane, one branch, sidecar-only through P1 (no claims re-lock until item 7).
Suggested commit sequence — each item is independently revertable and independently testable:

1. guard enforcement (largest single gain: it converts an existing dead scanner into a real gate)
2. pinned guard
3. read-before-write ledger
4. curator lineage
5. caps + symlink check
6. (optional) panel composer + re-lock

**Verification law for this lane:** `npm test` is `test:fast && test:http` — a red fast phase
means the 44 http suites never run, so read the whole log, and put the exit echo *inside* the
redirect (`{ npm test; echo "EXIT=$?"; } > log`). Before trusting any new guard test, revert the
guard and watch the test go red. Items 1 and 3 also need a **live** run each: a seeded dangerous
skill that must be withheld from a real run's prompt, and a real background-review pass that must
refuse a blind patch. A verification has a shelf life — gate, then merge promptly.
