# UI sound assets

All files in this directory are from the **Interface Bleeps** pack by **Bleeoop**:
https://bleeoop.itch.io/interface-bleeps

License (per the pack page): royalty-free; free to use in non-profit and commercial
projects. Reselling as assets or sample packs is not permitted — these files ship only
as embedded UI sounds of this application, which is within the license.

Cue mapping (chosen by Andrew, 2026-07-19; runtime pitch offsets applied in
frontend/js/util.js SFX — files are unmodified originals):

| file          | pack source    | cue                                  |
| ------------- | -------------- | ------------------------------------ |
| ui-click.wav  | Click_02       | button click (±4% drift)             |
| ui-open.wav   | Data_Point_04  | window open (1.0) / close (0.85)     |
| ui-alarm.wav  | Bleep_02       | alarm (1.0) / bad (0.9)              |
| ui-chime.wav  | Complete_02    | chime (memory / permission)          |
| ui-notify.wav | Confirm_04     | station bell                         |
| ui-msg.wav    | Bleep_03       | inbound message                      |
| ui-ship.wav   | Complete_01    | work delivered                       |
| ui-think.wav  | Data_Point_01  | voice ack "thinking"                 |
| ui-idea.wav   | Confirm_06     | proactive aside                      |
| ui-seed.wav   | Confirm_05     | saved to shelf                       |

Second pass (2026-07-27) — the cues COMMS fires were still on the old synth because no sample
had ever been mapped to them. All six play their own unmodified pack file at rate 1.0; the three
celebration stings are graded by the pack's own lengths, so quest stays smaller than a level-up.

| file             | pack source   | cue                                     |
| ---------------- | ------------- | --------------------------------------- |
| ui-type.wav      | Click_03      | typewriter tick (74ms — the pack's shortest) |
| ui-tick.wav      | Data_Point_05 | state committed (connector, key, transport) |
| ui-sale.wav      | Confirm_01    | settings export complete                |
| ui-quest.wav     | Confirm_02    | quest complete (235ms)                  |
| ui-milestone.wav | Sequence_07   | milestone (843ms)                       |
| ui-level.wav     | Sequence_06   | level up (1572ms)                       |
