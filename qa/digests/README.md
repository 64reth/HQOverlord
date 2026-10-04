# QA digests

The Overseer writes one morning digest per day here as `<date>.md`, generated from the
live ledger:

```
node scripts/qa/ledger.mjs --digest --date 2026-07-01 --write
```

Each digest is a point-in-time snapshot grouped by severity (P0 first) then crew. The
ledger itself (`qa/findings/`) is the source of truth; digests are the readable, dated
roll-up a human triages in the morning.
