import assert from "node:assert/strict";
import test from "node:test";

import {
  commandFingerprint,
} from "../src/index.ts";

test("command fingerprints are stable across object key order", () => {
  const first = commandFingerprint({
    objective: "Create article",
    options: {
      priority: "normal",
      language: "en",
    },
  });

  const second = commandFingerprint({
    options: {
      language: "en",
      priority: "normal",
    },
    objective: "Create article",
  });

  assert.equal(first, second);
});

test("different command inputs produce different fingerprints", () => {
  assert.notEqual(
    commandFingerprint({
      objective: "Create article",
    }),
    commandFingerprint({
      objective: "Create video",
    }),
  );
});
