import assert from "node:assert/strict";
import test from "node:test";

import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  ids,
  type Business,
} from "@hqoverlord/core";

import {
  correlationId,
  eventId,
} from "@hqoverlord/events";

import {
  commandId,
  DurableRuntime,
  FileDurableStore,
  RuntimeError,
  type CommandContext,
  type RuntimeClock,
  type RuntimeIds,
} from "../src/index.ts";

const occurredAt = "2026-10-02T12:00:00.000Z";

function testEnvironment(): {
  clock: RuntimeClock;
  ids: RuntimeIds;
} {
  let agentSequence = 0;
  let jobSequence = 0;
  let eventSequence = 0;

  return {
    clock: {
      now: () => occurredAt,
    },
    ids: {
      agent: () => {
        agentSequence += 1;
        return ids.agent(`generated-agent-${agentSequence}`);
      },
      job: () => {
        jobSequence += 1;
        return ids.job(`generated-job-${jobSequence}`);
      },
      event: () => {
        eventSequence += 1;
        return eventId(`generated-event-${eventSequence}`);
      },
    },
  };
}

function context(
  businessId: Business["id"],
  id: string,
): CommandContext {
  return {
    commandId: commandId(id),
    principal: {
      kind: "human",
      id: "test-user",
    },
    businessId,
    correlationId: correlationId(`correlation-${id}`),
  };
}

test("durable runtime survives restart and deduplicates the same command", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "hqoverlord-runtime-"),
  );

  try {
    const path = join(directory, "hq-state.json");

    const business: Business = {
      id: ids.business("business-a"),
      name: "Business A",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const durableStore = new FileDurableStore(path);

    await durableStore.save({
      version: 1,
      authority: {
        businesses: [business],
        agents: [],
        jobs: [],
      },
      facts: [],
      processedCommands: [],
    });

    const environment = testEnvironment();

    const firstRuntime = await DurableRuntime.open(
      new FileDurableStore(path),
      environment.clock,
      environment.ids,
    );

    const commandContext = context(
      business.id,
      "create-agent-1",
    );

    const firstResult = await firstRuntime.createAgent(
      commandContext,
      {
        name: "Research Agent",
        capabilities: ["research"],
      },
    );

    assert.equal(
      firstRuntime.snapshot().authority.agents.length,
      1,
    );

    assert.equal(
      firstRuntime.snapshot().facts.length,
      1,
    );

    assert.equal(
      firstRuntime.snapshot().processedCommands.length,
      1,
    );

    // Simulate HQ shutting down and starting again.
    const restartedRuntime = await DurableRuntime.open(
      new FileDurableStore(path),
      environment.clock,
      environment.ids,
    );

    assert.equal(
      restartedRuntime.snapshot().authority.agents.length,
      1,
    );

    const retriedResult = await restartedRuntime.createAgent(
      commandContext,
      {
        name: "Research Agent",
        capabilities: ["research"],
      },
    );

    assert.deepEqual(
      retriedResult,
      firstResult,
    );

    assert.equal(
      restartedRuntime.snapshot().authority.agents.length,
      1,
    );

    assert.equal(
      restartedRuntime.snapshot().facts.length,
      1,
    );

    assert.equal(
      restartedRuntime.snapshot().processedCommands.length,
      1,
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test("reusing a command ID with different input is rejected", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "hqoverlord-conflict-"),
  );

  try {
    const path = join(directory, "hq-state.json");

    const business: Business = {
      id: ids.business("business-a"),
      name: "Business A",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const store = new FileDurableStore(path);

    await store.save({
      version: 1,
      authority: {
        businesses: [business],
        agents: [],
        jobs: [],
      },
      facts: [],
      processedCommands: [],
    });

    const environment = testEnvironment();

    const runtime = await DurableRuntime.open(
      new FileDurableStore(path),
      environment.clock,
      environment.ids,
    );

    const commandContext = context(
      business.id,
      "same-command-id",
    );

    await runtime.createAgent(
      commandContext,
      {
        name: "First Agent",
      },
    );

    await assert.rejects(
      runtime.createAgent(
        commandContext,
        {
          name: "Different Agent",
        },
      ),
      (error: unknown) => {
        return (
          error instanceof RuntimeError &&
          error.code === "COMMAND_CONFLICT"
        );
      },
    );

    assert.equal(
      runtime.snapshot().authority.agents.length,
      1,
    );

    assert.equal(
      runtime.snapshot().facts.length,
      1,
    );

    assert.equal(
      runtime.snapshot().processedCommands.length,
      1,
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test("a command ID cannot cross business scope", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "hqoverlord-scope-"),
  );

  try {
    const path = join(directory, "hq-state.json");

    const businessA: Business = {
      id: ids.business("business-a"),
      name: "Business A",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const businessB: Business = {
      id: ids.business("business-b"),
      name: "Business B",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const store = new FileDurableStore(path);

    await store.save({
      version: 1,
      authority: {
        businesses: [businessA, businessB],
        agents: [],
        jobs: [],
      },
      facts: [],
      processedCommands: [],
    });

    const environment = testEnvironment();

    const runtime = await DurableRuntime.open(
      new FileDurableStore(path),
      environment.clock,
      environment.ids,
    );

    await runtime.createAgent(
      context(businessA.id, "shared-command"),
      {
        name: "Scoped Agent",
      },
    );

    await assert.rejects(
      runtime.createAgent(
        context(businessB.id, "shared-command"),
        {
          name: "Scoped Agent",
        },
      ),
      (error: unknown) => {
        return (
          error instanceof RuntimeError &&
          error.code === "COMMAND_CONFLICT"
        );
      },
    );

    assert.equal(
      runtime.snapshot().authority.agents.length,
      1,
    );

    assert.equal(
      runtime.snapshot().authority.agents[0]?.businessId,
      businessA.id,
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test("failed durable save does not publish working state", async () => {
  const business: Business = {
    id: ids.business("failure-business"),
    name: "Failure Business",
    status: "active",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };

  const initialState = {
    version: 1 as const,
    authority: {
      businesses: [business],
      agents: [],
      jobs: [],
    },
    facts: [],
    processedCommands: [],
  };

  let saveAttempts = 0;

  const failingStore = {
    async load() {
      return initialState;
    },

    async save() {
      saveAttempts += 1;
      throw new Error("Simulated disk failure");
    },
  };

  const environment = testEnvironment();

  const runtime = await DurableRuntime.open(
    failingStore,
    environment.clock,
    environment.ids,
  );

  await assert.rejects(
    runtime.createAgent(
      context(business.id, "failing-command"),
      {
        name: "Must Not Exist",
      },
    ),
    /Simulated disk failure/,
  );

  assert.equal(saveAttempts, 1);

  const state = runtime.snapshot();

  assert.equal(state.authority.agents.length, 0);
  assert.equal(state.facts.length, 0);
  assert.equal(state.processedCommands.length, 0);
});

test("concurrent commands are serialized without losing committed state", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "hqoverlord-concurrent-"),
  );

  try {
    const path = join(directory, "hq-state.json");

    const business: Business = {
      id: ids.business("concurrent-business"),
      name: "Concurrent Business",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const store = new FileDurableStore(path);

    await store.save({
      version: 1,
      authority: {
        businesses: [business],
        agents: [],
        jobs: [],
      },
      facts: [],
      processedCommands: [],
    });

    const environment = testEnvironment();

    const runtime = await DurableRuntime.open(
      new FileDurableStore(path),
      environment.clock,
      environment.ids,
    );

    const [first, second] = await Promise.all([
      runtime.createAgent(
        context(business.id, "concurrent-command-a"),
        { name: "Agent A" },
      ),
      runtime.createAgent(
        context(business.id, "concurrent-command-b"),
        { name: "Agent B" },
      ),
    ]);

    assert.notEqual(first.record.id, second.record.id);

    const state = runtime.snapshot();

    assert.equal(state.authority.agents.length, 2);
    assert.equal(state.facts.length, 2);
    assert.equal(state.processedCommands.length, 2);

    assert.deepEqual(
      state.authority.agents.map((agent) => agent.name),
      ["Agent A", "Agent B"],
    );

    const restarted = await DurableRuntime.open(
      new FileDurableStore(path),
      environment.clock,
      environment.ids,
    );

    assert.equal(
      restarted.snapshot().authority.agents.length,
      2,
    );
    assert.equal(
      restarted.snapshot().facts.length,
      2,
    );
    assert.equal(
      restarted.snapshot().processedCommands.length,
      2,
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test("runtime refuses restored agents whose business does not exist", async () => {
  const environment = testEnvironment();

  const corruptStore = {
    async load() {
      return {
        version: 1 as const,
        authority: {
          businesses: [],
          agents: [
            {
              id: ids.agent("orphan-agent"),
              businessId: ids.business("missing-business"),
              name: "Orphan Agent",
              status: "idle" as const,
              capabilities: [],
              toolIds: [],
            },
          ],
          jobs: [],
        },
        facts: [],
        processedCommands: [],
      };
    },

    async save() {
      throw new Error("save should not be reached");
    },
  };

  await assert.rejects(
    DurableRuntime.open(
      corruptStore,
      environment.clock,
      environment.ids,
    ),
    (error: unknown) =>
      error instanceof RuntimeError &&
      error.code === "INVALID_STATE",
  );
});

test("runtime refuses processed commands referencing missing facts", async () => {
  const business: Business = {
    id: ids.business("validation-business"),
    name: "Validation Business",
    status: "active",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };

  const environment = testEnvironment();

  const corruptStore = {
    async load() {
      return {
        version: 1 as const,
        authority: {
          businesses: [business],
          agents: [],
          jobs: [],
        },
        facts: [],
        processedCommands: [
          {
            commandId: "broken-command",
            businessId: business.id,
            inputFingerprint: "fingerprint",
            eventIds: ["missing-event"],
            result: {
              kind: "job" as const,
              recordId: "missing-job",
            },
          },
        ],
      };
    },

    async save() {
      throw new Error("save should not be reached");
    },
  };

  await assert.rejects(
    DurableRuntime.open(
      corruptStore,
      environment.clock,
      environment.ids,
    ),
    (error: unknown) =>
      error instanceof RuntimeError &&
      error.code === "INVALID_STATE",
  );
});
