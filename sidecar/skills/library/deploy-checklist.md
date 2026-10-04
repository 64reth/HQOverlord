---
name: Deploy Checklist
slug: deploy-checklist
description: Get an app from "works on my machine" to actually live — reproduce the build, fix the real error, and verify the deployed thing responds.
category: Engineering
requires: [workbench, cabinet]
license: MIT
default: false
---

Most failed deploys are one of a handful of causes, and almost none of them are what the error message appears to say. The discipline is to reproduce the production build locally before touching any hosting dashboard.

## Method
1. **Reproduce the production build first** with shell.exec — the exact build command, not the dev server. A dev server hides missing env vars, case-sensitive import paths, and dependencies that live in devDependencies. If it fails locally, it was never a hosting problem.
2. **Read the FIRST error, not the last.** Build output cascades; the final message is usually a symptom of something three hundred lines earlier.
3. **Walk the usual causes in order:** missing or misnamed environment variables; a dependency in the wrong section of the manifest; imports whose case does not match the filename (fine on macOS/Windows, fatal on Linux); a hardcoded localhost URL; a Node version mismatch; a build script that assumes a file not in the repo.
4. **Get the env vars right explicitly.** List every variable the code reads, which are needed at BUILD time versus RUN time, and which are safe to expose to the browser. Never move a secret into a client-visible variable to make a build pass.
5. **Verify the deployed thing, not the dashboard's green tick.** Fetch the live URL, check the pages render, exercise one real path that touches the backend, and read the runtime logs for errors the build did not catch.
6. **Write down what actually fixed it** so the next deploy is not a rediscovery.

## Rules
- **Never claim it is deployed because the build passed.** Verified means you loaded the live URL and something real worked.
- **Never paste a secret into a command, a log, or a commit** — set it in the host's env settings and reference it by name.
- Change one thing per attempt; a batch of five guesses teaches nothing about which mattered.
- If a fix requires a destructive or irreversible action on the host, describe it and hand the decision back.

## Output
What was broken and why, what changed, the verified live URL with what you exercised on it, then any env var or setting the Commander still has to apply themselves.

*Needs the WORKBENCH (builds, logs) and the CABINET (source and config).*
