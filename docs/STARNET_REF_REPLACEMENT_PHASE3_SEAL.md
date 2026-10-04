# StarNet Phase 3 Seal

This is the closing loop for Phase 1-3. It keeps the completed work honest and
bounded before Phase 4 planning starts.

## Goal

Phase 1-3 is sealed when:

- Phase 3 browser automation and computer-use rows are labeled as automated
  contract proof, not ref-proven live parity.
- Test and steering commands have hard timeouts so a hung runner cannot burn CPU
  forever.
- The latest Phase 1-3 evidence summaries are preserved in
  `docs/STARNET_PHASE4_BASELINE.md`.
- The seal runner is green:

```powershell
npm.cmd run phase3:seal
```

Loop form:

```powershell
npm.cmd run phase3:seal:loop
```

## What The Seal Does Not Claim

The seal does not claim StarNet is ready to replace the reference harnessAgent. It only says the
Phase 1-3 work is honest enough to become the baseline for Phase 4.

Phase 4 still owns:

- Paid live provider proof.
- Attended gamified UI dogfood proof.
- Two complete dogfood passes, one fresh and one after restart.
- Cargo/Rust desktop release build proof.

## Evidence

Seal evidence is written to `.dogfood/phase3-seal-latest/`.
