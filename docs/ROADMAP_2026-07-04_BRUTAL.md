# StarNet roadmap — 7 / 30 / 90 days (brutal edition)

Written 2026-07-04, grounded in trunk state: v0.1.7 installed, GitHub-Releases updater LIVE,
release:cut kit working, UX audit + fix plan in flight, all test gates green.
Scope filter: only work that moves **usefulness, trust, retention, or revenue**. Everything
else is explicitly on the STOP list.

---

## The brutal truths this roadmap is built on

1. **You have zero users.** Not "few" — zero people outside this room have ever run StarNet.
   Every additional feature built before launch is inventory for a store with no door. The
   bottleneck is not capability — the harness demonstrably works (live-LLM smoke, 17/17 UI
   sweep, real tool runs). The bottleneck is that nobody can download it.
2. **The launch has been "one Andrew-task away" for weeks.** The repo publish, email swap,
   and key rotation are the same three items from the 07-03 sprint. They take under an hour.
   Meanwhile new lanes keep spawning. That is avoidance dressed as productivity.
3. **The attended playtest keeps getting skipped.** Ship-readiness gate 5 has read
   "NOT YET DONE" across multiple ship cycles. If the builder won't sit through 10 minutes of
   his own first-run, no beginner will sit through it either.
4. **Revenue is structurally impossible today.** BYOK is free by design, there is no payment
   rail, no metering, no managed-key path. Nothing on trunk can produce a dollar. 90 days
   must end with exactly ONE working revenue rail — not a marketplace, not a pricing page
   essay — one rail that can charge a card.
5. **The unsigned installer is the biggest funnel killer you control.** SmartScreen scares
   beginners; SAC hard-blocks them with an identical-looking dialog. Your target user — less
   technical than a reference-harness user — dies at the download. A code-signing identity
   (Azure Trusted Signing, ~$10/mo) removes this and nothing else on this list matters until
   it's gone or documented around.
6. **Distribution is already sitting in the building.** Andrew is an AI-content creator; the
   GTM thesis says spectacle/watchability IS the growth engine. The clip exporter shipped.
   Zero clips have been posted. The cheapest user acquisition available is being left unused.
7. **The feature surface is now a liability.** 84 props, 28 skills, recipes, routines,
   autonomy tiers, away workshop, XP, voice, themes — built to ref-parity depth with zero
   external validation of ANY loop. The next 90 days should delete/park more than they add.

---

## Days 1–7: LAUNCH. Nothing else counts.

**Definition of done for the week: a stranger can download StarNet from a public URL,
install it, and reach one real deliverable — and at least 10 strangers have.**

| # | Item | Why it's on the list | Owner |
|---|------|----------------------|-------|
| 1 | Andrew's launch checklist: support email swap, rotate dev OpenRouter key, create `starnet-releases` public repo | Blocks everything; the email placeholder is a shipped-broken trust breaker (audit Theme 7) | Andrew (~1h) |
| 2 | Merge UX fix plan **Wave 1 P0s only** (error doors, open-folder on deliverables, approval-pause state, routines-disarmed banner, away-workshop honesty, dismiss confirms) | These are the trust breakers a first user hits in minutes; all cheap, all planned, lanes already shaped | agents |
| 3 | **Attended 15-min playtest, fresh profile, before the cut** | Gate 5 has been dodged repeatedly; it is the only gate that simulates a user | Andrew |
| 4 | Re-cut LAST, publish v0.1.8 to GitHub Releases, verify the updater applies a trivial v0.1.9 (the true unattended-update proof) | Launch gotchas #1 and #3 from LAUNCH_CHECKLIST | agents + Andrew |
| 5 | Download page live with the SmartScreen-vs-SAC install flows shown side-by-side with screenshots | Every unsigned-Windows-app funnel dies here; honesty up front beats a mystery block | agents |
| 6 | Get 10 outside installs: post 1 clip (exporter already works) + hand the link to friends/Discord/Twitter | Zero → ten users teaches more than any audit | Andrew |
| 7 | A feedback door INSIDE the app: "something broken/confusing?" → prefilled diagnostics email or GitHub issue | Local-first means no telemetry; without this you launch blind | agents (small) |

**Explicitly NOT this week:** any new feature lane, P1/P2 audit items, macOS, marketplace,
spectacle beyond one clip, parked branches (north-star, hermes-parity-loop, cortex-hermes-plus).

---

## Days 8–30: prove one loop retains, kill the download killer

**Definition of done for the month: you can name the day-7 return rate of your first cohort,
the installer no longer triggers SmartScreen, and the top 3 observed (not predicted)
drop-offs are fixed.**

### Trust / funnel
- **Code-signing identity** (Azure Trusted Signing or OV cert). This is the single
  highest-leverage trust purchase available. Target: v0.1.x signed within the month.
- **Weekly release cadence**, every release through the live updater. An updater that fires
  weekly is a retention channel; one that fired once is a demo.
- Watch every new user you can (screen-share, video call, literally sit behind them). Five
  observed first-runs outrank the entire 106-finding janitor backlog.

### Usefulness / retention
- **Metric that matters: time-to-first-kept-deliverable** (a file the user opens and keeps).
  Target < 10 minutes from install. The audit says outputs are invisible (Theme 4) — Wave 1
  fixes the affordance; now measure the reality.
- Ship UX **P1 comprehension** items (glossary layer, human model labels, slash
  discoverability, budget bars, diegetic no-key narration) — but ONLY the ones real users
  actually stumbled on. The audit is a menu, not a mandate.
- **Return loop validation:** away-workshop + return digest + routines are the retention
  thesis. If the first cohort never triggers them, that's the finding — fix the on-ramp
  (routines suggested from real usage) before polishing the mechanism.
- Content engine: **1 clip per week minimum** from real usage. This is both distribution and
  the watchability thesis test. If clips don't pull installs by day 30, the GTM thesis needs
  revision — better to learn now.

### Kill list (park these unless a real user asks)
- Meeseeks frontend sprite layer, G5 spectacle expansion, new props/classes/skills,
  ref-parity leftovers, the three parked mega-branches. Freeze the surface; the next
  30 days are funnel and loop, not width.

---

## Days 31–90: one revenue rail, earned expansion

**Definition of done for the quarter: at least one person who is not Andrew has paid money,
via a rail that meters real usage — and weekly retention of the active cohort is known and
above zero.**

### Revenue (the only new BUILD of the quarter)
- **Managed-key starter credits.** The locked thesis is resold-AI + BYOK. Build the minimum:
  Stripe checkout → credit balance → StarNet routes through a metered proxy key → the
  existing budget engine (caps, per-scope spend, already on trunk) enforces the ceiling.
  This is ALSO the biggest onboarding fix you have: it deletes the "go create an OpenRouter
  account" wall — the hardest step in the current first-run — for exactly the beginner the
  product targets.
- Price it simply: free BYOK forever (the moat/goodwill), $10 starter credits for
  key-less onboarding. No tiers, no subscriptions yet — one SKU, one rail, real invoices.
- **Do NOT build the marketplace this quarter.** Open-core marketplace needs sellers and
  buyers; you need double-digit retained users first. Metering compute is the revenue
  experiment that matches the current scale.

### Retention (compound what works)
- Double down on whichever loop the 30-day cohort actually used (routines vs. away builds
  vs. daily hero work) and cut friction on that path specifically.
- **D7/D30 numbers drive the backlog.** If retention is near zero, stop building and do
  10 more observed sessions — the answer will be embarrassingly specific, and it will not
  be "add a feature."

### Expansion (strictly gated)
- **macOS build ONLY IF** the Windows funnel shows real retention. It roughly doubles the
  creator-audience TAM but costs a toolchain, a signing identity, and a CI story — don't pay
  that for a funnel that hasn't converted on Windows.
- Community home (Discord) once there are ~25 real users to put in it, not before.
- Content cadence continues; by day 90 you should know clips-per-install cold.

### Quarter-end honesty checkpoint
Answer in writing, with numbers: installs, D7 retention, kept-deliverables per user,
dollars collected, clip → install conversion. If any is zero, the next quarter's plan is
"fix that zero" — not a new system, not parity with anything.

---

## The one-line version

**7 days: ship it to strangers. 30 days: sign it, watch users, prove one loop. 90 days:
one Stripe-metered revenue rail and nothing else new.** The product is over-built and
under-launched; every decision above trades width for proof.
