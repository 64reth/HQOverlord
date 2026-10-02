import assert from "node:assert/strict";
import test from "node:test";

import type { BusinessId } from "@hqoverlord/core";
import type { CorrelationId } from "@hqoverlord/events";

import {
  commandId,
  type CommandContext,
  type Principal,
} from "../src/index.ts";

test("command identifiers reject empty values", () => {
  assert.throws(() => commandId(""), /cannot be empty/);
  assert.throws(() => commandId("   "), /cannot be empty/);

  assert.equal(commandId("command-001"), "command-001");
});

test("command context carries trusted business scope and correlation", () => {
  const principal: Principal = {
    kind: "human",
    id: "operator-001",
  };

  const context: CommandContext = {
    commandId: commandId("command-001"),
    principal,
    businessId: "business-a" as BusinessId,
    correlationId: "correlation-001" as CorrelationId,
  };

  assert.equal(context.businessId, "business-a");
  assert.equal(context.correlationId, "correlation-001");
  assert.equal(context.principal.kind, "human");
});

test("principal kinds are explicit", () => {
  const principals: readonly Principal[] = [
    { kind: "human", id: "human-001" },
    { kind: "agent", id: "agent-001" },
    { kind: "system", id: "runtime" },
  ];

  assert.deepEqual(
    principals.map((principal) => principal.kind),
    ["human", "agent", "system"],
  );
});
