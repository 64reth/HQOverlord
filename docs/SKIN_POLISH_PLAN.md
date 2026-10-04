# Skin polish — the recipe, the queue, and the cost

**Status 2026-07-26:** 5 of 36 skins polished (crthead, voidwizard, skeleton, ghostface, capybara).
**Blocked on Pixellab quota, not on technique.** Tier 1 sits at 1,962/2,000 used with credits at
−$0.54, so there is no fallback. The remaining 27 distinct characters need **648 generations**.

## The recipe that works (do not re-derive this — it cost a day)

Per skin, in order:

1. **Idle — `create_character_state` on the ORIGINAL Pixellab character.** ~20 generations.
   NOT `create_character`. The state tool *"keeps the source's identity, body type, and
   proportions"*, so the build is preserved structurally. Measured drift across 4 skins: **0px**
   on three, +2px width on one. Nothing else preserves the build — see the failure log below.
   - `use_color_palette_from_reference: false` (true caps the palette at the source's ~12 colours
     and defeats the entire point), and instead put the hue lock in the prompt.
   - Prompt shape: *"Keep the EXACT same character, same pose, same silhouette, same body size,
     same proportions and the SAME COLOURS — change only the rendering quality. Add richer shading
     by introducing lighter and darker SHADES OF THE EXISTING COLOURS ONLY: … Do NOT change the
     outline shape, the pose, the proportions, the head size, the hues or the overall dimensions."*
   - Add a per-character colour guard where identity IS the palette (e.g. skeleton: *"keep the bone
     pure white, do NOT make it tan, warm, beige or fleshy"*). Without it, it drifts warm.

2. **Walk — `animate_character(template_animation_id='walk', directions=[4 cardinals])`.** 4 generations.
   Pass the 4 cardinals explicitly; an 8-direction character otherwise bills all 8 and the game
   only uses 4.

3. **Blink — FREE, derived, no generation.** The OLD `rot`/`blink` pair encodes exactly which
   pixels a blink touches. Diff them to get a mask, paste the old blink through that mask onto the
   NEW idle. The blink then *is* the new art with the eyes shut and cannot disagree with the idle.
   Measured: gap went from 44 colours behind to 0. Precedent: the original pipeline did this and
   measured 0.8% frame drift vs 84% for a regenerated blink.

4. **Sit — NOT SOLVED.** Still the old flat art (~7-12 colours vs ~50 on the new idle). It is the
   visible seam because agents sit at workstations constantly. Another `create_character_state`
   at ~20 each = 720 for the full roster. Deferred, not skipped.

5. **Assemble** with `scripts` equivalent of `_assembly/assemble.py`: 92×92 canvas, content bottom
   → FOOT_Y 69, centre-x → CX 46, walk frames horizontally locked to that direction's idle centre.
   The download ZIP bundles EVERY state in the group, one folder each — select the folder that
   contains `animations/walk/`, never alphabetically.

6. **Scale** — only if height changed. It did not on any skin so far, so `DATA.SKINS` was untouched.

## Cost

| item | per skin | × 27 |
|---|---|---|
| idle state-edit | 20 | 540 |
| walk | 4 | 108 |
| blink | 0 (derived) | 0 |
| **minimum** | **24** | **648** |
| sit parity (all 36) | 20 | 720 |

## Queue — source character IDs (resolved)

| set | source id | set | source id |
|---|---|---|---|
| endoskeleton | `e30d1197-5733-40e8-a8d0-319f39aefb22` | astronaut | `c01cab90-a5ce-4733-b7f2-5dc48fbaf50a` |
| heisenberg | `99ed62eb-1ac2-4f7f-b7ee-d52054341d3c` | vaultboy | `f9022b14-4dce-4761-a204-391c553b51ee` |
| robot | `688b77cc-5c2b-423a-afb2-c974242a18c6` | crewmate | `f7214c81-2f8b-4750-a156-6916fc6481f3` |
| alien | `851b7b25-1597-4c95-825f-22900086e81e` | steve | `ea50696a-4722-4a7b-a3ba-7b6702b319cf` |
| pepe | `b10db73a-8455-4385-a893-e10381f9170b` | minionchar | `a978b651-c4f2-4aa9-b632-0ad38e74d228` |
| robocop | `cd0fa7f8-c00f-450c-a9e8-0bdcc450e329` | ninjaturtle | `2368eab4-71ca-4fbe-bcb4-df9b6b93aa6a` |
| ricksanchez | `1433e5ff-db5a-4576-b791-bb30289e11bc` | morpheus | `92ee7d7a-e480-41db-8271-84b5a0d79423` |
| freddyfazbear | `bc4912d9-16b4-45ce-bc96-94693607b0b3` | beachbabe | `746df698-2143-4fcd-a8e2-7303cbbe3efe` |
| dario | `79419c26-1461-4988-9c52-a14f07732555` | samaltman | `4509a065-5cd1-4878-8d98-9d52dfc71095` |
| plaguedoctor | `2dd77016-cfa9-435a-a06f-ea90d4dd2fa2` | grimreaper | `d916e3c7-285f-4966-a14c-787345d84b5d` |
| secretagent | `db725795-7caf-4ccf-b85d-1358492f03af` | ultrondroid | `f7a626d9-6364-4e31-8c71-b7d32a20fa72` |
| xenomorph | `f160043d-bc40-441e-88f5-4048b44001b4` | masterchief | `8e8517ea-88ee-4e90-b5d5-90d8b1a97263` |
| pikachu | `1b0d60cf-8c16-4c18-aaed-505bb4c2fb9c` | caseyjones | `2a49e6a9-07bb-4fb1-981d-4a3da365ee28` |
| ultron | `1c7a5b63-d966-4317-bb05-1642eb7613df` | | |

**UNRESOLVED — find before running:** `bear`, `finn`.
**SPECIAL CASE:** `blank`, `blank_amber`, `blank_blue`, `blank_green`, `blank_red` are five recolours
of one base (`f3f37f6c-2d7c-49fb-9e3a-ca49c2498445`). Polish the base ONCE, then re-apply the existing
hue shifts — do not spend 5 × 24 on them.

## Failure log — approaches that DO NOT work (all tested)

- **`create_character` in v3 mode** — highest quality, but **ignores `proportions`**. Every roll
  reinvents the build. Produced w/h 0.82-1.00 against a 0.45 roster median ("short wide chuds"),
  then heads at 14% of body height against a 38% roster norm. `_preset/preset.json` says this
  outright in its own `_note`; read it first.
- **`create_character` in standard mode + `detailed shading`/`high detail`** — holds the build
  (drift +0.02 w/h) but the quality knobs are soft guidance and barely move: skeleton went 12 → 11
  colours. The originals were authored at `basic shading`/`medium detail`; turning those up is
  not the lever.
- **Raising `size` to 96 in standard mode** — genuinely adds shape detail at the correct build, but
  it is a resolution increase, which Andrew has now rejected three separate times. See
  `sprite-pixelation-rule`.
- **Root insight:** a 16×40 sprite is ~640 pixels. "More detail at identical proportions AND
  identical resolution" is not available from a generator — only from *redrawing the same pixels
  better*, which is exactly what the state-edit does.
