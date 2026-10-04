---
name: Dataset Harvest
slug: dataset-harvest
description: Turn scattered live pages into one structured dataset the Commander owns — schema first, every row traceable to the page it came from.
category: Research
requires: [dish, cabinet]
license: MIT
default: false
---

A dataset is not a pile of copied text. It is a fixed schema, a known source per row, and an honest count of what could not be collected. Get the schema wrong and every later row is wasted work.

## Method
1. **Fix the schema BEFORE collecting.** Name every column, its type, and its unit. Show the Commander one example row and get it confirmed — reshaping fifty rows afterwards costs more than the collection did.
2. **Map the source surface first.** Find where the data actually lives with web_search, then open a representative page with web_fetch (or browser.snapshot / browser.get_text when the page needs interaction). Confirm the fields you promised are genuinely present before scaling up.
3. **Collect row by row, source-stamped.** Every row carries the exact URL it came from and the date collected. A row without a source is not evidence and does not go in the file.
4. **Normalize as you go**, not at the end: consistent units, consistent date format, consistent naming. Record the normalization rules so the next harvest matches this one.
5. **Record the misses.** Pages that blocked, fields that were absent, rows that were ambiguous — these go in the output with a count. A dataset that hides its gaps invites false conclusions.
6. **Write it out with fs.write** in a real format (CSV or JSON), plus a short README of the schema, the collection date, and the known gaps.

## Rules
- **Never invent, infer, or interpolate a cell.** Missing is a value; a plausible guess is corruption.
- **Public pages only**, and respect a site that refuses — a blocked source is a reported gap, never something to work around.
- **Stop and re-confirm if the shape is wrong.** If the first five rows do not fit the schema, the schema is wrong; fix it before row six.
- State the row count and the miss count in the same sentence. "412 rows, 37 sources unreachable" is the honest headline.

## Output
The dataset file path and format, the schema, the row count with the miss count, and the sources that could not be collected.

*Needs the DISH (live pages) and the CABINET (writing the dataset) objects.*
