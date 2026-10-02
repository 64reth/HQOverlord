import type {
  DurableState,
} from "./durable-state.ts";

import {
  RuntimeError,
} from "./runtime-error.ts";

export function validateDurableState(
  state: DurableState,
): void {
  const businessIds = new Set(
    state.authority.businesses.map(
      (business) => business.id,
    ),
  );

  const agentIds = new Set<string>();
  const jobIds = new Set<string>();
  const eventIds = new Set<string>();
  const commandIds = new Set<string>();

  for (const agent of state.authority.agents) {
    if (!businessIds.has(agent.businessId)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Agent ${agent.id} references missing business ${agent.businessId}`,
      );
    }

    if (agentIds.has(agent.id)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Duplicate agent identifier ${agent.id}`,
      );
    }

    agentIds.add(agent.id);
  }

  for (const job of state.authority.jobs) {
    if (!businessIds.has(job.businessId)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Job ${job.id} references missing business ${job.businessId}`,
      );
    }

    if (jobIds.has(job.id)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Duplicate job identifier ${job.id}`,
      );
    }

    jobIds.add(job.id);

    if (job.agentId !== undefined) {
      const agent = state.authority.agents.find(
        (candidate) => candidate.id === job.agentId,
      );

      if (agent === undefined) {
        throw new RuntimeError(
          "INVALID_STATE",
          `Job ${job.id} references missing agent ${job.agentId}`,
        );
      }

      if (agent.businessId !== job.businessId) {
        throw new RuntimeError(
          "INVALID_STATE",
          `Job ${job.id} references an agent from another business`,
        );
      }
    }
  }

  for (const fact of state.facts) {
    if (!businessIds.has(fact.businessId)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Event ${fact.id} references missing business ${fact.businessId}`,
      );
    }

    if (eventIds.has(fact.id)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Duplicate event identifier ${fact.id}`,
      );
    }

    eventIds.add(fact.id);
  }

  for (const processed of state.processedCommands) {
    if (!businessIds.has(processed.businessId as never)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Processed command ${processed.commandId} references missing business ${processed.businessId}`,
      );
    }

    if (commandIds.has(processed.commandId)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Duplicate processed command identifier ${processed.commandId}`,
      );
    }

    commandIds.add(processed.commandId);

    for (const processedEventId of processed.eventIds) {
      if (!eventIds.has(processedEventId)) {
        throw new RuntimeError(
          "INVALID_STATE",
          `Processed command ${processed.commandId} references missing event ${processedEventId}`,
        );
      }
    }

    if (
      processed.result.kind === "agent" &&
      !agentIds.has(processed.result.recordId)
    ) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Processed command ${processed.commandId} references missing agent result ${processed.result.recordId}`,
      );
    }

    if (
      processed.result.kind === "job" &&
      !jobIds.has(processed.result.recordId)
    ) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Processed command ${processed.commandId} references missing job result ${processed.result.recordId}`,
      );
    }
  }
}
