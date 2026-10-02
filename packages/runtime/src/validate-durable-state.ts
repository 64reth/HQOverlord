import type {
  DurableState,
} from "./durable-state.ts";

import {
  RuntimeError,
} from "./runtime-error.ts";
import { commandFingerprint } from "./command-fingerprint.ts";
import { validateModelState } from "./validate-model-state.ts";

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

  const invalid = (message: string): never => { throw new RuntimeError("INVALID_STATE", message); };
  if (state.approvals !== undefined && !Array.isArray(state.approvals)) invalid("Invalid approvals section");
  if (state.executions !== undefined && !Array.isArray(state.executions)) invalid("Invalid executions section");
  const approvals = state.approvals ?? [];
  const executions = state.executions ?? [];
  const approvalIds = new Set<string>();
  const operationIds = new Set<string>();
  const executionJobs = new Set<string>();
  for (const approval of approvals) {
    if (!approval || approvalIds.has(approval.id) || operationIds.has(approval.operationId)) invalid("Duplicate or invalid approval");
    approvalIds.add(approval.id);
    operationIds.add(approval.operationId);
    const job = state.authority.jobs.find(j => j.id === approval.jobId);
    if (!job || job.businessId !== approval.businessId) invalid("Approval references a missing or cross-business job");
    if (!["pending", "approved", "rejected", "cancelled"].includes(approval.status)) invalid("Invalid approval status");
    if (!approval.toolCall || approval.toolCall.kind !== "tool" || typeof approval.toolCall.toolId !== "string") invalid("Approval has no exact tool call");
    if (approval.status === "pending" && !executions.some(e => e.jobId === approval.jobId && e.status === "waiting_for_approval" && e.operation?.approvalId === approval.id)) {
      invalid("Pending approval has no waiting execution");
    }
  }
  for (const execution of executions) {
    if (!execution || executionJobs.has(execution.jobId)) invalid("Duplicate or invalid execution");
    executionJobs.add(execution.jobId);
    const job = state.authority.jobs.find(j => j.id === execution.jobId);
    const agent = state.authority.agents.find(a => a.id === execution.agentId);
    if (!job || !agent || job.businessId !== execution.businessId || agent.businessId !== execution.businessId || job.agentId !== agent.id) {
      invalid("Execution references missing or cross-business records");
    }
    if (!Number.isInteger(execution.turns) || execution.turns < 0 || !Number.isInteger(execution.maxTurns) || execution.maxTurns < 1 || execution.turns > execution.maxTurns || !Array.isArray(execution.observations)) invalid("Invalid execution checkpoint");
    if (!["running", "waiting_for_approval", "completed", "failed", "cancelled"].includes(execution.status)) invalid("Invalid execution status");
    const jobStatus = execution.status === "waiting_for_approval" ? "running" : execution.status;
    if (job!.status !== jobStatus) invalid("Job and execution status disagree");
    if (["completed", "failed", "cancelled"].includes(execution.status) && execution.outcome?.status !== execution.status) invalid("Terminal execution has no matching outcome");
    const operation = execution.operation;
    if (operation) {
      if (!operation.call || operation.call.kind !== "tool" || typeof operation.call.toolId !== "string" || typeof operation.dispatched !== "boolean") invalid("Invalid operation checkpoint");
      if (operation.approvalId) {
        const approval = approvals.find(a => a.id === operation.approvalId);
        if (!approval || approval.jobId !== job!.id || approval.businessId !== execution.businessId || approval.operationId !== operation.id || commandFingerprint(approval.toolCall) !== commandFingerprint(operation.call)) {
          invalid("Operation and exact approval binding disagree");
        }
        if (operation.dispatched && approval!.status !== "approved") invalid("Dispatched operation lacks approval");
      }
    }
    if (execution.status === "waiting_for_approval" && (!operation?.approvalId || operation.dispatched)) invalid("Waiting execution has no undispatched approval");
  }
  validateModelState(state);
}
