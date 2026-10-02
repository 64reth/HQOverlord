import type {
  Agent,
  Job,
} from "@hqoverlord/core";

import type {
  HQEvent,
} from "@hqoverlord/events";

import {
  AuthorityStore,
} from "./authority-store.ts";

import {
  CommandService,
  type CommandResult,
  type CreateAgentCommand,
  type CreateJobCommand,
} from "./command-service.ts";

import type {
  CommandContext,
} from "./command-context.ts";

import {
  commandFingerprint,
} from "./command-fingerprint.ts";

import type {
  DurableState,
  ProcessedCommand,
} from "./durable-state.ts";

import type {
  DurableStore,
} from "./durable-store.ts";

import type {
  RuntimeClock,
  RuntimeIds,
} from "./runtime-environment.ts";

import {
  RuntimeError,
} from "./runtime-error.ts";

import {
  validateDurableState,
} from "./validate-durable-state.ts";

type AgentResult = CommandResult<
  Agent,
  HQEvent<"agent.created">
>;

type JobResult = CommandResult<
  Job,
  HQEvent<"job.created">
>;

export class DurableRuntime {
  readonly #durableStore: DurableStore;
  readonly #clock: RuntimeClock;
  readonly #ids: RuntimeIds;

  #state: DurableState;
  #transactionTail: Promise<void> = Promise.resolve();

  private constructor(
    durableStore: DurableStore,
    clock: RuntimeClock,
    ids: RuntimeIds,
    state: DurableState,
  ) {
    this.#durableStore = durableStore;
    this.#clock = clock;
    this.#ids = ids;
    this.#state = state;
  }

  static async open(
    durableStore: DurableStore,
    clock: RuntimeClock,
    ids: RuntimeIds,
  ): Promise<DurableRuntime> {
    const state = await durableStore.load();

    validateDurableState(state);

    return new DurableRuntime(
      durableStore,
      clock,
      ids,
      state,
    );
  }

  snapshot(): DurableState {
    return this.#state;
  }

  async createAgent(
    context: CommandContext,
    command: CreateAgentCommand,
  ): Promise<AgentResult> {
    return this.#serialize(async () => {
      const fingerprint = commandFingerprint({
        type: "createAgent",
        command,
      });

      const existing = this.#findProcessedCommand(
        context,
        fingerprint,
      );

      if (existing !== undefined) {
        if (existing.result.kind !== "agent") {
          throw new RuntimeError(
            "COMMAND_CONFLICT",
            "Command ID was previously used for a different result type",
          );
        }

        return this.#restoreAgentResult(existing);
      }

      const workingStore = new AuthorityStore(
        this.#state.authority,
      );

      const service = new CommandService(
        workingStore,
        this.#clock,
        this.#ids,
      );

      const result = service.createAgent(
        context,
        command,
      );

      const processed: ProcessedCommand = {
        commandId: context.commandId,
        businessId: context.businessId,
        inputFingerprint: fingerprint,
        eventIds: [result.event.id],
        result: {
          kind: "agent",
          recordId: result.record.id,
        },
      };

      const nextState: DurableState = {
        version: this.#state.version,
        authority: workingStore.snapshot(),
        facts: [
          ...this.#state.facts,
          result.event,
        ],
        processedCommands: [
          ...this.#state.processedCommands,
          processed,
        ],
      };

      await this.#durableStore.save(nextState);

      this.#state = nextState;

      return result;
    });
  }

  async createJob(
    context: CommandContext,
    command: CreateJobCommand,
  ): Promise<JobResult> {
    return this.#serialize(async () => {
      const fingerprint = commandFingerprint({
        type: "createJob",
        command,
      });

      const existing = this.#findProcessedCommand(
        context,
        fingerprint,
      );

      if (existing !== undefined) {
        if (existing.result.kind !== "job") {
          throw new RuntimeError(
            "COMMAND_CONFLICT",
            "Command ID was previously used for a different result type",
          );
        }

        return this.#restoreJobResult(existing);
      }

      const workingStore = new AuthorityStore(
        this.#state.authority,
      );

      const service = new CommandService(
        workingStore,
        this.#clock,
        this.#ids,
      );

      const result = service.createJob(
        context,
        command,
      );

      const processed: ProcessedCommand = {
        commandId: context.commandId,
        businessId: context.businessId,
        inputFingerprint: fingerprint,
        eventIds: [result.event.id],
        result: {
          kind: "job",
          recordId: result.record.id,
        },
      };

      const nextState: DurableState = {
        version: this.#state.version,
        authority: workingStore.snapshot(),
        facts: [
          ...this.#state.facts,
          result.event,
        ],
        processedCommands: [
          ...this.#state.processedCommands,
          processed,
        ],
      };

      await this.#durableStore.save(nextState);

      this.#state = nextState;

      return result;
    });
  }

  #findProcessedCommand(
    context: CommandContext,
    fingerprint: string,
  ): ProcessedCommand | undefined {
    const existing = this.#state.processedCommands.find(
      (processed) =>
        processed.commandId === context.commandId,
    );

    if (existing === undefined) {
      return undefined;
    }

    if (
      existing.businessId !== context.businessId ||
      existing.inputFingerprint !== fingerprint
    ) {
      throw new RuntimeError(
        "COMMAND_CONFLICT",
        "Command ID was already used with different input or business scope",
      );
    }

    return existing;
  }

  #restoreAgentResult(
    processed: ProcessedCommand,
  ): AgentResult {
    const agent = this.#state.authority.agents.find(
      (candidate) =>
        candidate.id === processed.result.recordId,
    );

    const event = this.#state.facts.find(
      (candidate) =>
        candidate.id === processed.eventIds[0],
    );

    if (
      agent === undefined ||
      event === undefined ||
      event.type !== "agent.created"
    ) {
      throw new RuntimeError(
        "INVALID_STATE",
        "Processed agent command references missing durable state",
      );
    }

    return {
      record: agent,
      event,
    };
  }

  #restoreJobResult(
    processed: ProcessedCommand,
  ): JobResult {
    const job = this.#state.authority.jobs.find(
      (candidate) =>
        candidate.id === processed.result.recordId,
    );

    const event = this.#state.facts.find(
      (candidate) =>
        candidate.id === processed.eventIds[0],
    );

    if (
      job === undefined ||
      event === undefined ||
      event.type !== "job.created"
    ) {
      throw new RuntimeError(
        "INVALID_STATE",
        "Processed job command references missing durable state",
      );
    }

    return {
      record: job,
      event,
    };
  }

  async #serialize<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.#transactionTail;

    let release!: () => void;

    this.#transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }
}
