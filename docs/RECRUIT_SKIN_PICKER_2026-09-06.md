# Recruitment skin picker visibility — 2026-09-06

The redesign left all 36 character skins behind a small collapsed Appearance row. Replace that disclosure with an always-visible Choose a skin section beside the live preview, and move recruitment controls above the class reference text. The skin grid remains scrollable; name, skin and model behavior are unchanged.

Seeded live proof on :9198: initial-open thumbnails are visible above the summon footer; selecting Teddy Bear updates the selected thumbnail and animated preview; the choice and entered name survive a class switch; the narrow layout has no horizontal overflow; actually summoning a test recruit creates the selected skin, retained after page reload. Browser console and exception collectors were empty. Evidence: ignored `.uishots-skins/live-check.log`, `skin-picker.png`, and `skin-picker-narrow.png` in the recruit-skin-picker worktree. Test recruits exist only in that dev seed.

Full-gate and integration receipts follow in qa/STATUS.md. This does not rebuild or install the desktop app.

Owner's final spacing adjustment: both catalogs now use a compact header and search field. Live browser measurements at the same scale: header 76 -> 44.95px; search 49 -> 31.95px. Recruitment search for researcher and Recipes search for fix a bug both returned the correct roster item. The visible preview on :9198 was refreshed.
