import type {
  Agent,
  AgentId,
  Job,
  JobId,
  ToolId,
  WorkflowId,
} from "@hqoverlord/core";

import type {
  EventActor,
  HQEvent,
} from "@hqoverlord/events";

import type {
  CommandContext,
  Principal,
} from "./command-context.ts";

import {
  AuthorityStore,
} from "./authority-store.ts";

import type {
  RuntimeClock,
  RuntimeIds,
} from "./runtime-environment.ts";

export interface CreateAgentCommand {
  readonly name: string;
  readonly capabilities?: readonly string[];
  readonly toolIds?: readonly ToolId[];
}

export interface CreateJobCommand {
  readonly dependsOn?: readonly JobId[];
  readonly inputArtifactIds?: readonly string[];
  readonly objective: string;
  readonly agentId?: AgentId;
  readonly workflowId?: WorkflowId;
}

export interface CommandResult<
  Record,
  Event extends HQEvent,
> {
  readonly record: Record;
  readonly event: Event;
}

const RUNTIME_PRODUCER = "hq.runtime";

function eventActor(
  principal: Principal,
): EventActor {
  return {
    kind: principal.kind,
    id: principal.id,
  };
}

export class CommandService {
  readonly #store: AuthorityStore;
  readonly #clock: RuntimeClock;
  readonly #ids: RuntimeIds;

  constructor(
    store: AuthorityStore,
    clock: RuntimeClock,
    ids: RuntimeIds,
  ) {
    this.#store = store;
    this.#clock = clock;
    this.#ids = ids;
  }

  createAgent(
    context: CommandContext,
    command: CreateAgentCommand,
  ): CommandResult<
    Agent,
    HQEvent<"agent.created">
  > {
    this.#store.requireBusiness(context);

    const name = command.name.trim();

    if (name.length === 0) {
      throw new TypeError(
        "Agent name must not be empty",
      );
    }

    const agent: Agent = {
      id: this.#ids.agent(),
      businessId: context.businessId,
      name,
      status: "idle",
      capabilities: [
        ...(command.capabilities ?? []),
      ],
      toolIds: [
        ...(command.toolIds ?? []),
      ],
    };

    const event: HQEvent<"agent.created"> = {
      id: this.#ids.event(),
      type: "agent.created",
      occurredAt: this.#clock.now(),

      businessId: context.businessId,

      correlationId: context.correlationId,
      causationId: null,

      actor: eventActor(context.principal),
      producer: RUNTIME_PRODUCER,

      payload: {
        agentId: agent.id,
        name: agent.name,
        status: "idle",
        capabilities: agent.capabilities,
        toolIds: agent.toolIds,
      },
    };

    this.#store.addAgent(agent);

    return {
      record: agent,
      event,
    };
  }

  createJob(
    context: CommandContext,
    command: CreateJobCommand,
  ): CommandResult<
    Job,
    HQEvent<"job.created">
  > {
    this.#store.requireBusiness(context);
    for (const upstream of command.dependsOn ?? []) this.#store.requireJob(context, upstream);

    const objective = command.objective.trim();

    if (objective.length === 0) {
      throw new TypeError(
        "Job objective must not be empty",
      );
    }

    if (command.agentId !== undefined) {
      this.#store.requireAgent(
        context,
        command.agentId,
      );
    }

    const job: Job = {
      id: this.#ids.job(),
      businessId: context.businessId,
      objective,
      status: "queued",
      ...(command.dependsOn ? { dependsOn: [...command.dependsOn] } : {}),
      ...(command.inputArtifactIds ? { inputArtifactIds: [...command.inputArtifactIds] } : {}),

      ...(command.agentId !== undefined
        ? {
            agentId: command.agentId,
          }
        : {}),

      ...(command.workflowId !== undefined
        ? {
            workflowId: command.workflowId,
          }
        : {}),
    };

    const event: HQEvent<"job.created"> = {
      id: this.#ids.event(),
      type: "job.created",
      occurredAt: this.#clock.now(),

      businessId: context.businessId,

      correlationId: context.correlationId,
      causationId: null,

      actor: eventActor(context.principal),
      producer: RUNTIME_PRODUCER,

      payload: {
        jobId: job.id,
        objective: job.objective,
        status: "queued",

        ...(job.agentId !== undefined
          ? {
              agentId: job.agentId,
            }
          : {}),

        ...(job.workflowId !== undefined
          ? {
              workflowId: job.workflowId,
            }
          : {}),
      },
    };

    this.#store.addJob(job);

    return {
      record: job,
      event,
    };
  }
}
