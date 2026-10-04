---
fingerprint: de0bb232
slug: sent-group-attachments-appear-only-in-the-shared
title: Sent group attachments appear only in the shared shelf
surface: sessions
severity: P1
status: fixed
found: 2026-09-06
lane: release-0110
fix: fe5be77a9
origin: owner
report: Owner 0.11.0 installer test, 2026-09-06, image 1
affected: Windows 0.11.0 candidate 2cfdcb04e
family: message-attachments
installer: unverified
recovery: unconfirmed
---

# Sent group attachments appear only in the shared shelf

## Symptom

Sending a photo in a group conversation leaves it only in SHARED. The sent message does not show what was attached.

## Repro

1. Open a group conversation in the 2cfdcb04e installer.
2. Attach a PNG, enter a message and send it.
3. Observe that the file appears in SHARED while the message has no attachment.

## Evidence

Owner screenshot 1 (2026-09-06). Live seeded reproduction on :9188 showed the first sent message without an attachment and the image in SHARED. After the source fix, the second message had one loaded image thumbnail; an attachment-only third send had one loaded image and one document button. Both associations survived a sidecar restart and page reload. Machine anchor: test/group-message-attachments.test.js. Before-fix log: .bugloops/polish-attachments-before.log; HTTP proof: .bugloops/polish-group-http.log.

## Verdict

Source repair fe5be77a9 is implemented and live proof is recorded. Exact installer behavior and owner recovery remain unverified.

## Regression

The new upload retry assertion failed against the original 09c9d4ba module (2 artifacts instead of 1). The fixed suite passes association, exact bytes, validation, cross-group isolation, retry, branching and restart. Live browser proof confirms thumbnails on the correct message and full image preview. Historical unlinked files remain in SHARED because their original message cannot be proved.

## Sibling coverage

{
  "adapters": [
    {
      "target": "group durable store",
      "state": "covered",
      "test": "test/group-message-attachments.test.js",
      "scenario": "message file association, validation and upload retries",
      "gate": "fast"
    },
    {
      "target": "real sidecar HTTP",
      "state": "covered",
      "test": "test/group-sessions.http.test.js",
      "scenario": "upload/send/read, original bytes and restart",
      "gate": "http"
    },
    {
      "target": "direct-to-group history import",
      "state": "blocked",
      "reason": "Historical direct attachments were not migrated by this repair; that pre-existing conversion path needs separate end-to-end coverage."
    }
  ],
  "entrypoints": [
    {
      "target": "send and branch",
      "state": "covered",
      "test": "test/group-message-attachments.test.js",
      "scenario": "branch keeps only attachments linked to retained messages",
      "gate": "fast"
    },
    {
      "target": "file picker and attachment-only send",
      "state": "blocked",
      "reason": "Verified manually in the live :9188 browser, including PNG plus Markdown; no registered browser automation asserts this picker flow."
    }
  ],
  "displays": [
    {
      "target": "Windows source browser",
      "state": "blocked",
      "reason": "Live thumbnails, full image viewer and file buttons were inspected; exact new installer retest remains pending."
    },
    {
      "target": "macOS WebView",
      "state": "blocked",
      "reason": "No physical Mac is available in this Windows lane."
    }
  ],
  "lifecycle": [
    {
      "target": "restart and retry",
      "state": "covered",
      "test": "test/group-message-attachments.test.js",
      "scenario": "store restart preserves associations and idempotent upload",
      "gate": "fast"
    },
    {
      "target": "HTTP sidecar restart",
      "state": "covered",
      "test": "test/group-sessions.http.test.js",
      "scenario": "persisted message attachment can be fetched after process restart",
      "gate": "http"
    }
  ]
}
