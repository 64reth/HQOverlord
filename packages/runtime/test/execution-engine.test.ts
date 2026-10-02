import assert from "node:assert/strict";
import test from "node:test";

import {
  ids,
  type Agent,
  type Job,
  type Tool,
} from "@hqoverlord/core";

import {
  ExecutionEngine,
  ToolRegistry,
  type AgentDriver,
  type ExecutableTool,
} from "../src/index.ts";

const businessId =
  ids.business("business-a");

const searchToolId =
  ids.tool("research.search");

const forbiddenToolId =
  ids.tool("external.publish");

function agent(
  toolIds = [searchToolId],
): Agent {
  return {
    id: ids.agent("agent-a"),
    businessId,
    name: "Researcher",
    status: "idle",
    capabilities: ["research"],
    toolIds,
  };
}

function job(): Job {
  return {
    id: ids.job("job-a"),
    businessId,
    agentId: ids.agent("agent-a"),
    objective: "Research HQOverlord",
    status: "queued",
  };
}

function searchTool(): ExecutableTool {
  const definition: Tool = {
    id: searchToolId,
    name: "Search",
    description: "Searches for information",
    effect: "read_only",
  };

  return {
    definition,

    async execute(input, context) {
      assert.equal(
        context.businessId,
        businessId,
      );

      return {
        output: {
          query: input,
          answer:
            "HQOverlord is operational.",
        },
      };
    },
  };
}

test(
  "agent executes an allowed tool and completes from its observation",
  async () => {
    const registry = new ToolRegistry();

    registry.register(searchTool());

    let turn = 0;

    const driver: AgentDriver = {
      async next(context) {
        turn += 1;

        if (turn === 1) {
          assert.equal(
            context.observations.length,
            0,
          );

          return {
            kind: "tool",
            toolId: searchToolId,
            input: "What is HQOverlord?",
          };
        }

        assert.equal(
          context.observations.length,
          1,
        );

        return {
          kind: "complete",
          output:
            context.observations[0]
              ?.result.output,
        };
      },
    };

    const engine =
      new ExecutionEngine(registry);

    const result = await engine.execute(
      job(),
      agent(),
      driver,
    );

    assert.deepEqual(result, {
      status: "completed",
      output: {
        query: "What is HQOverlord?",
        answer:
          "HQOverlord is operational.",
      },
    });
  },
);

test(
  "registered tools cannot be used without agent permission",
  async () => {
    const registry = new ToolRegistry();

    registry.register(searchTool());

    const driver: AgentDriver = {
      async next() {
        return {
          kind: "tool",
          toolId: searchToolId,
          input: "secret",
        };
      },
    };

    const result =
      await new ExecutionEngine(
        registry,
      ).execute(
        job(),
        agent([]),
        driver,
      );

    assert.equal(
      result.status,
      "failed",
    );

    assert.equal(
      result.error?.code,
      "BUSINESS_SCOPE_VIOLATION",
    );
  },
);

test(
  "an unregistered tool fails without execution",
  async () => {
    const registry = new ToolRegistry();

    const driver: AgentDriver = {
      async next() {
        return {
          kind: "tool",
          toolId: forbiddenToolId,
          input: {},
        };
      },
    };

    const result =
      await new ExecutionEngine(
        registry,
      ).execute(
        job(),
        agent([forbiddenToolId]),
        driver,
      );

    assert.equal(
      result.status,
      "failed",
    );

    assert.equal(
      result.error?.code,
      "INVALID_STATE",
    );
  },
);

test(
  "execution rejects an agent from another business",
  async () => {
    const registry = new ToolRegistry();

    const otherAgent: Agent = {
      ...agent(),
      businessId:
        ids.business("business-b"),
    };

    const driver: AgentDriver = {
      async next() {
        return {
          kind: "complete",
          output: "should not run",
        };
      },
    };

    await assert.rejects(
      () =>
        new ExecutionEngine(
          registry,
        ).execute(
          job(),
          otherAgent,
          driver,
        ),
      /different businesses/,
    );
  },
);

test(
  "execution stops runaway drivers at the configured turn limit",
  async () => {
    const registry = new ToolRegistry();

    registry.register(searchTool());

    const driver: AgentDriver = {
      async next() {
        return {
          kind: "tool",
          toolId: searchToolId,
          input: "again",
        };
      },
    };

    const result =
      await new ExecutionEngine(
        registry,
        {
          maxTurns: 3,
        },
      ).execute(
        job(),
        agent(),
        driver,
      );

    assert.deepEqual(result, {
      status: "failed",
      error: {
        code: "MAX_TURNS_EXCEEDED",
        message:
          "Execution exceeded 3 turns",
      },
    });
  },
);

test(
  "tool implementation is replaceable without changing the execution engine",
  async () => {
    const registry = new ToolRegistry();

    const apiStyleTool: ExecutableTool = {
      definition: {
        id: searchToolId,
        name: "API Search",
        description:
          "Represents a future external API adapter",
        effect: "read_only",
      },

      async execute(input) {
        return {
          output: {
            provider: "future-api",
            input,
          },
        };
      },
    };

    registry.register(apiStyleTool);

    let first = true;

    const driver: AgentDriver = {
      async next(context) {
        if (first) {
          first = false;

          return {
            kind: "tool",
            toolId: searchToolId,
            input: {
              query: "test",
            },
          };
        }

        return {
          kind: "complete",
          output:
            context.observations[0]
              ?.result.output,
        };
      },
    };

    const result =
      await new ExecutionEngine(
        registry,
      ).execute(
        job(),
        agent(),
        driver,
      );

    assert.deepEqual(result, {
      status: "completed",
      output: {
        provider: "future-api",
        input: {
          query: "test",
        },
      },
    });
  },
);
