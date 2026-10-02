import assert from "node:assert/strict";
import test from "node:test";

import {
  currencyCode,
  money,
} from "@hqoverlord/core";

import {
  decodeMoney,
  encodeMoney,
} from "../src/index.ts";

test("money survives durable encoding beyond JavaScript safe integer range", () => {
  const original = money(
    900719925474099312345678901234567890n,
    currencyCode("GBP"),
  );

  const stored = encodeMoney(original);

  assert.deepEqual(stored, {
    minorUnits: "900719925474099312345678901234567890",
    currency: "GBP",
  });

  const json = JSON.stringify(stored);
  const parsed = JSON.parse(json) as {
    minorUnits: string;
    currency: string;
  };

  const restored = decodeMoney(parsed);

  assert.equal(restored.minorUnits, original.minorUnits);
  assert.equal(restored.currency, original.currency);
});

test("money decoder rejects unsafe or malformed durable representations", () => {
  assert.throws(
    () => decodeMoney({ minorUnits: "12.34", currency: "GBP" }),
    /non-negative base-10 integer/,
  );

  assert.throws(
    () => decodeMoney({ minorUnits: "-1", currency: "GBP" }),
    /non-negative base-10 integer/,
  );

  assert.throws(
    () => decodeMoney({ minorUnits: "100", currency: "gbp" }),
    /three-letter uppercase code/,
  );
});
