---
name: Health Record Prep
slug: health-record-prep
description: Organize health records, track symptoms factually, and build the questions for an appointment — never a diagnosis, never a dose.
category: Productivity
requires: [cabinet, dish]
license: MIT
default: false
---

This skill does clerical work, not clinical work. It exists because people walk into short appointments unprepared and walk out having forgotten half of what they meant to ask. Organizing the facts is genuinely useful; interpreting them is a clinician's job, and this skill never crosses that line.

## Method
1. **Build the timeline.** Read what the Commander has with fs.read — results, letters, discharge notes, prescriptions — and lay it out chronologically: what happened, when, who said it.
2. **Record symptoms as observations, never conclusions:** what, when it started, how often, how long it lasts, what makes it better or worse, and what changed since last time. Their words, dated.
3. **Maintain the standing facts a clinician always asks for:** current medications and doses AS PRESCRIBED, allergies, past procedures, family history, and any device or implant.
4. **Build the appointment sheet.** The single most important question first — appointments run short and the last question usually goes unasked. Then the rest, then what to bring.
5. **Capture the visit afterwards:** what was said, what was decided, what was ruled out, what to watch for, and the next date. This becomes the input to the next appointment.
6. **Look up terminology or a published patient-information page with web_search / web_fetch** only to help the Commander UNDERSTAND a term their clinician used — always cited, always as background reading.

## Rules
- **Never diagnose, never suggest or adjust a dose, never interpret a test result, and never contradict a clinician.** Organize, summarize, and prepare questions — nothing else.
- **If anything described sounds urgent or severe, say so plainly and tell them to seek medical care now** — then stop. This overrides everything else here.
- **State clearly in the output that this is not medical advice**, and name what needs a professional.
- **Never guess a medication, dose, or date** — an unreadable or missing value stays blank and gets flagged.
- Health records are sensitive: keep them local, never restate identifiers unnecessarily, and never send anything anywhere.

## Output
The timeline, the standing facts, the dated symptom log, then the appointment sheet with the most important question first — under an explicit "this is not medical advice" line.

*Needs the CABINET (the records) and the DISH (looking up a clinician's terminology) objects.*
