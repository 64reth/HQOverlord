# Group chat integration verification — 2026-09-05

Worktree: `C:/Users/andro/gen-trees/group-dm-plan-0904`
Branch: `agent/group-dm-plan-0904`
Candidate: `89ba9fcdf` (source `3f76c6077`)
Integrated trunk snapshot: `ff9e147cf044e9c3a9206f1fecc92cda0afbc8be`.

## Integration

Merged trunk into the feature branch without rebasing or touching the integration tree.
The initial trunk snapshot was `010a6b50f`; the approved station interface landed during
verification (`6085f26b8`), followed by session/workflow updates (`ff9e147cf`). All are
included in this candidate. Generated release-surface locks were refreshed without
changing claim verdicts. Both script imports were retained in the HTML conflict;
both ignored development directories were retained in .gitignore.

The station interface introduced `.comms-identity` and `.comms-portrait` wrappers.
Group mode now hides those direct-session wrappers so names, count, and Add agents
remain on the existing single identity line. Direct sessions restore both wrappers.
No new feature scope or settings were added.

## Live evidence

Preview: http://127.0.0.1:9137/ using `node dev/seed.js --keep`, the existing scratch
workspace, isolated `dev/.group-profile`, and configured Haiku provider.

- Created a group through + NEW → Add agents → + ADD → START GROUP CHAT.
- Explicit Add ENGINEER and mention changed membership from two to three, populated
  @engineer, and left the message count at zero.
- ENGINEER brief.ask offered Short/Detailed. Reload preserved the question. Short
  resumed the same run `cad816e1-07c0-49fb-bec7-ea8bf9953313`, which completed.
- NOVA Alpha/Beta question survived a hard sidecar restart. Typed Beta was stored once;
  original run `2827a343-35dc-4eac-a5a0-ea4b56acd9f1` was not replayed. Continuation
  `7d1ff62f-0fed-47ad-8383-4657f422e7ac` completed with Beta.
- Stop canceled RESEARCHER's pending Red/Blue question; no pending card after reload.
- With the approved station interface loaded, header/transcript/composer shared x=8
  and width=617 at a 633px viewport; no page horizontal overflow. Direct identity and
  portrait were hidden in group mode. The picker remained a .term under #terms; sampled
  buttons used station colors, without white/gray native control paint.
- Removed ENGINEER via the native picker and SAVE; header became two members.
- Switching to a direct session restored identity/portrait and one composer. A real
  direct run completed (provider replied OK).
- Integration test group: `ws_mto1fx0x2cj0`. Earlier Group DM live test and its artifact
  correction cycle remain preserved.

## Gates

Final integrated candidate: **716 fast steps and 97 HTTP steps GREEN**.
The unchanged manifests ran sequentially with a 1200-second outer deadline via
`npm run test:fast:raw` and `npm run test:http:raw`; wrapper process exit was zero.
Logs: `dev/group-final-fast.log` and `dev/group-final-http.log`. No tests were
excluded. Earlier runs interrupted by integration updates and the desktop restart
are not counted as pass receipts. Source syntax checks and website synchronization
passed; the final sync changed zero files. Final HTTP preview check returned 200.
At verification completion, trunk had zero commits absent from this branch.

## Remaining boundary

No merge back to trunk, installed desktop certification, push, or release performed.
This task prepares a verified local candidate for the user's final usability test.
Watchdog long thresholds remain covered by deterministic fault tests rather than
waiting 450/1200 seconds in the interactive preview.

Final-candidate live follow-up: NOVA dispatched one group.handoff to RESEARCHER;
run `43eba908-bacb-482d-8319-9e326e6cda95` completed with HANDOFF SENT and peer run
`70c889bc-d02e-478b-8086-99670a16cefa` completed with PEER OK. The transcript displayed
NOVA asked RESEARCHER to follow up once. Browser warning/error log was empty.
Final preview launcher PID: 12212 (rediscover child before stopping).
