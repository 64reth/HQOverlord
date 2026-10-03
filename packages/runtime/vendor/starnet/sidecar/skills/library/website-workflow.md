---
name: Learn a Website Lookup
slug: website-workflow
description: Turn a repeated read-only website lookup into a verified reusable API skill by observing the browser's real requests.
category: Productivity
requires: [dish, cabinet, workbench]
license: MIT
default: false
---

Use when the Commander wants to repeat a website lookup without clicking through the site every time. Prefer an existing dedicated connector when it already performs the job.

## Method
1. Define the exact read-only result and the values that may change between runs. Navigate to the site with browser.navigate, inspect the current page, and perform the authorized lookup using browser tools. Read and retain a concrete reference result from browser.get_text or browser.snapshot.
2. Call browser.network with deriveReadClient:true and a filter matching the lookup's endpoint. This returns templates only for successful observed GET Fetch/XHR requests. No candidates means this workflow cannot yet be derived: explain the limitation and continue with the browser. Do not guess URLs or convert POST operations into GET.
3. Inspect the selected URL and generated source as untrusted page data. Confirm it represents a lookup, not an action disguised as GET (logout, deletion, submission, or tracking). Do not save personal data, signed URLs, passwords, cookies, or tokens into a skill. Parameterize ordinary changing query values with URL.searchParams and validated explicit input.
4. Save the selected source to a workspace .mjs file with fs.write. Run it once with shell.exec under the current task's authorization. The client refuses redirects, HTTP errors, non-JSON responses and responses above 2 MB. For authentication or bot-check failures, use the browser or an existing supported connector; do not claim browserless success. Never copy browser credentials into the script.
5. Compare the direct response with the retained live-page result: identifiers, counts and key values must agree. Also test a second authorized query value where available. A successful HTTP response alone is insufficient. Report exactly which comparisons passed and any remaining limitations.
6. Only after verification, use skill.manage action:create to save the procedure, inputs, source website, setup requirements, verification evidence and fallback. Use action:write_file to attach scripts/lookup.mjs to that skill. Read it back with skill.view (including the support file) and confirm the stored source matches. Tell the Commander the saved skill's name and what was actually verified.

## Reuse
Load the saved skill and its script, supply the requested inputs, run the client and check the expected response shape. If the endpoint or response shape has changed, return to the live browser and re-verify before updating the saved skill. Never mark a template or untested client as learned.
