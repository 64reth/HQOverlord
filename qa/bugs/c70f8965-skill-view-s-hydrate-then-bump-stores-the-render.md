---
fingerprint: c70f8965
slug: skill-view-s-hydrate-then-bump-stores-the-render
title: skill.view's hydrate-then-bump stores the RENDERED SKILL.md as the skill's body, so every view→persist cycle re-appends '## Setup' and '## Support Files' — unbo
surface: skills
severity: P0
status: fixed
found: 2026-07-28
lane: sweep/skills
fix: 598ab4a4
---

# skill.view's hydrate-then-bump stores the RENDERED SKILL.md as the skill's body, so every view→persist cycle re-appends '## Setup' and '## Support Files' — unbo

## Symptom

A saved skill that has `setup` text and/or support files silently rots. After the first time the agent reads it, the skill's body in the SKILLS panel, in skills.jsonl and in SKILL.md on disk carries a duplicated `## Setup` section and a duplicated `## Support Files` list. Every subsequent read adds another copy. The Commander sees their own procedure growing garbage headings they never typed; once the body passes 20 000 chars the next sidecar boot truncates it and the real steps at the tail are gone for good. Any Commander approval on that skill also breaks permanently, because the content digest moves on every cycle so an approved skill re-asks forever.

## Repro

node this against the real modules (proven, output below): create a package-backed store (`makeSkillStore({ io, clock, redact, guard: skillGuard, digest: digestOf, packageStore })`), then `s.write({ agentId:'a', name:'Deploy', body:'1. npm ci\n2. npm test', setup:'Node 20 and a clean tree.' })`, `s.manage({ action:'write_file', target:id, path:'references/notes.md', content:'hello' })`, then loop three times over `s.view('a', id)` (what the skill.view TOOL does — bump defaults true) followed by `s.markUsed('a',[id])` (what every run does). Stored body goes 21 → 99 → 177 → 255 bytes; the disk SKILL.md ends up with FOUR identical `## Setup` blocks and four `## Support Files` lists. Live equivalent: save a skill with setup notes, have the agent call skill.view on it, start any second run, open ABILITIES > SKILLS.

## Evidence

`sidecar/skillstore.js:473`

**Mechanism (read from the code):** `view()` hydrates from disk and then writes the hydrated record into the in-memory `latest` map: `if (opts2.bump !== false) { out = clone(out); … bumpView(out); }` (skillstore.js:465-474) where `out.body` came from `packageStore.hydrate(...)` (skillstore.js:455-463). But `hydrate()` returns `out.body = parsed.body` (package.js:187) — and `parsed.body` is everything after the frontmatter of the file `renderSkillMd()` wrote, i.e. `frontmatter + '## Setup\n' + setup + '\n\n' + body + '## Support Files\n- `…`'` (package.js:54-62). So `body` is set to the whole rendered document while the separate `setup` field and `files` map are untouched. `bumpView(entry)` does `latest.set(keyOf(...), clone(entry))` (skillstore.js:192-195) with no re-render, no re-digest and no clamp. The next persist that clones from `latest` — and `markUsed()` is that persist, called on EVERY run for every indexed skill id at sidecar/index.js:11018 `if (rs.ids && rs.ids.length …) skillStore.markUsed(agentId, rs.ids)` — writes the poisoned body back through `persist()` → `packageStore.writePackage()`, which renders `## Setup` in FRONT of a body that already contains `## Setup`. `persist()` never clamps (only `makeEntry()` calls `red(e.body, bodyMax)`), so growth is unbounded in RAM and in the JSONL; the only clamp is `body: str(r.body).slice(0, BODY_MAX)` in `normalizeEntry` (skillstore.js:110) at boot, which truncates the END — the actual steps — while keeping the accumulated Setup blocks at the front. `contentDigest` is re-stamped from the new body on each persist (skillstore.js:212), so any `skills-allowed.json` approval keyed to the old digest is invalidated every cycle.

**Existing test coverage:** test/skills.test.js §K (lines 166-185) is the only test that exercises hydrate with a `setup:` value and support files, and every one of its reads passes `{ bump: false }` — so the write-back never fires. test/skills.gate.test.js §B does tamper-then-view with bump defaults, but on a skill with NO setup and NO files, where render/parse is a fixed point and the body is stable. No test covers view-with-bump on a skill that has setup or support files.

**Adversarial verdict (survived refutation):** Reproduced exactly against the real modules. sidecar/skillstore.js:455-463 sets out.body from packageStore.hydrate(), which returns parsed.body (sidecar/skills/package.js:187) = everything after the frontmatter of the document renderSkillMd() wrote (package.js:54-62), i.e. it already contains '## Setup' and '## Support Files'. skillstore.js:465-474 then clones that into `latest` via bumpView (skillstore.js:192-195) with no re-render and no re-digest, while the separate `setup` field and `files` map are left intact. The next persist re-renders Setup in FRONT of a body that already has it. Wiring is live: sidecar/index.js:809 constructs the store with packageStore+guard+digest; viewTool (sidecar/tools/builtin/skills.js) calls store.view(agentId, name) with no opts so bump AND hydrate both default on; sidecar/index.js:11018 calls skillStore.markUsed(agentId, rs.ids) for every indexed skill on every run, and markUsed (skillstore.js:477-489) clones from `latest` straight into persist() with no makeEntry, hence no red()/clamp. My run: body 21 -> 99 -> 177 -> 255 bytes over three view+markUsed cycles; contentDigest moved every cycle (f5d281cc-73 -> e0e76248-151 -> f6a027f0-229 -> dc468aa4-307), so any skills-allowed.json approval is invalidated forever; disk SKILL.md ended with FOUR '## Setup' blocks and FOUR '## Support Files' lists. Only normalizeEntry (skillstore.js:110) clamps, at boot, slicing the END. Not deliberate: the bumpView comment states the intent is counters-only ('update the in-memory latest copy WITHOUT appending a JSONL line'), not a body write-back. Tests do not cover it: test/skills.test.js §K (lines 166-185) is the only hydrate test with setup+files and every read passes {bump:false}; §H line 119 uses bump-default but on a store with NO packageStore, so hydrate never runs; test/skills.gate.test.js §B uses bump-default on a body with no setup and no files, where render/parse is a fixed point. Two minor imprecisions that do not change the verdict: the accumulated '## Support Files' lists sit at the tail, so the 20000-char boot truncation eats those before it reaches the real steps, and the corruption only affects skills that actually have setup text or support files (a bare-body skill round-trips cleanly).

_Found by the `sweep/skills` lane, 2026-07-28. Finder confidence: high. Severity claimed P0, after refutation P0._

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
