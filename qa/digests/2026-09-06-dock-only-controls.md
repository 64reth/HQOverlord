# Dock-only styling rollback — 2026-09-06

Owner request: remove this task's styling changes everywhere except the Crew, Work, Build and System bottom bar. Preserve other tasks' work and the previously requested E-STOP removal.

Production commit: e4e4512b198279e35cdd9f2cc2be9d786b02e87f. Reviewed-source fingerprint commit: c78577f52d5ca6f620ab5988c6e99551b19400a3.

The remaining shared styles were removed from non-dock tooltips, the navigation hint and COMMS starters. Dock styles and their variables are now limited to #bottombar and hover cards whose active anchor belongs to it. The original navigation-hint markup is restored. Newer session-starter content/layout and quest-journal changes are preserved.

Live proof on the isolated seeded app, port 8967: 164 comparisons / 1,267 control observations, zero differences and no console warnings or exceptions. Non-dock styles were compared against pre-task 3d31e373e; dock styles against approved 61d2ba4de. The same DOM and stylesheet positions were used for each comparison, with animations/transitions disabled only in the fixture for stable frames. The comparison covers Channels overview and all five setup panes, rest/hover in six themes; ten Settings sections; COMMS session/footer controls; the original navigation hint; original outside tooltips; four dock menus and hover states; dock triggers; dock tooltip arrows; and shared glossary card reuse inside/outside the dock. The detailed check inventory is in 2026-09-06-dock-only-styles.json.

Focused gates passed: station-tooltip 419 assertions, control-floor 113, starters 37, frontend/website mirror 8. Syntax checks passed for both changed controllers and the tooltip regression. The owner subsequently requested improved enable switches; inset phosphor sliders were verified in six themes with native keyboard interaction, disabled behavior and reduced motion in both Settings and marketplace variants. Both changes merged in 6999618c2; the full fast gate passed all 725 steps before and after integration. No installer was rebuilt, and owner recovery is unconfirmed.
