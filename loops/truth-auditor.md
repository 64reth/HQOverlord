# L2 · Truth Auditor — the app must never lie (every 2h, live app)

Mandate: **truthful telemetry.** Any UI element asserting state the harness can't prove is a
bug, even if it looks polished. (Past catches: SETTINGS hiding a live Codex connection; SKILLS
hardcoding TERMINAL as granted with no workbench; cosmetic conveyor belts.)

## Each tick
1. Ensure the REAL app is up: `npm start` → http://127.0.0.1:8787 (NEVER `npm run serve` — it's
   UI-only/dead). Use preview tools / DOM round-trips; screenshots time out on the game canvas.
2. Pick the next area from the rotation below (persist your position in qa/findings/truth-rotation.txt):
   SETTINGS → COMMS → SKILLS → STORE/credits → agent dossier → BUILD/props → LOGBOOK/ledger →
   CONNECTORS/channels → ROUTINES/cron → onboarding surfaces.
3. For every claim the panel makes (connected, granted, running, costs, counts, statuses),
   find the backend truth: the API route, the store, the event. Three verdicts:
   - **HONEST** — claim matches a provable backend state.
   - **LIE** — claim contradicts backend state, or asserts state nothing enforces.
   - **UNPROVABLE** — no backend source exists for the claim (design smell; file it).
4. **Grep trunk before filing** — confirm the lie exists in current code, not in a stale memory
   of the code.
5. LIEs ≤30 lines with an obvious honest fix: fix in your own lane (branch `agent/truth-fix-*`),
   gate green, mark READY for L1. Bigger: file to qa/findings/ with route+file+line evidence.

## Digest
One line per area audited: `AREA — honest N / lies N / unprovable N` + finding IDs.
