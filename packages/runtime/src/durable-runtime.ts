import type {
  Agent,
  Job,
  JobId,
  Approval,
  ApprovalId,
  LedgerEntry,
  Money,
} from "@hqoverlord/core";
import { ids } from "@hqoverlord/core";
import type { Artifact, Source, KnowledgeFact, RecordProvenance } from "./knowledge.ts";
import type { HQEventPayloadMap, HQEventType } from "@hqoverlord/events";
import { ExecutionEngine } from "./execution-engine.ts";
import type { AgentDriver, ExecutionResult, ToolCall } from "./execution-contracts.ts";
import type { DurableExecution, DurableApproval } from "./durable-state.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { ModelDrivenAgentDriver, type ModelDriverOptions } from "./model-driven-agent-driver.ts";
import { normalizeModelUsage, type ModelProvider, type ModelRequest, type ModelResult } from "./model-provider.ts";
import { maximumModelCost, priceModelUsage, validateModelPricing, type ModelPricing } from "./model-pricing.ts";
import { modelAccountTotals, modelMeteredTotals, type JobModelAccount, type ModelInvocation, type ModelPolicy } from "./model-state.ts";
import { maximumMeteredCost, priceMeteredUsage, usdCentsToNanoUsd, validateMeteredPricing, type MeteredExpense, type MeteredPricing } from "./metered-cost.ts";

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
  PersistenceBoundaryError,
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

export interface ModelExecutionOptions extends ModelDriverOptions {
  readonly maxTurns?: number;
  readonly pricing?: ModelPricing;
  readonly meteredPricing?: MeteredPricing;
  readonly budget?: Money;
}

export class DurableRuntime {
  readonly #durableStore: DurableStore;
  readonly #clock: RuntimeClock;
  readonly #ids: RuntimeIds;

  #state: DurableState;
  #transactionTail: Promise<void> = Promise.resolve();
  readonly #active = new Map<JobId, AbortController>();
  readonly #listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  isJobActive(context: CommandContext, jobId: JobId): boolean {
    this.#job(context, jobId);
    return this.#active.has(jobId);
  }

  #provenance(context: CommandContext, jobId?: JobId): RecordProvenance {
    new AuthorityStore(this.#state.authority).requireBusiness(context);
    const job = jobId ? this.#job(context, jobId) : undefined;
    return { businessId: context.businessId, createdAt: this.#clock.now(), correlationId: context.correlationId,
      actor: { ...context.principal }, producer: "hq.runtime", ...(job ? { jobId: job.id, ...(job.agentId ? { agentId: job.agentId } : {}) } : {}) };
  }

  readArtifact(context: CommandContext, artifactId: string): Artifact {
    new AuthorityStore(this.#state.authority).requireBusiness(context);
    const artifact = this.#state.artifacts?.find(a => a.id === artifactId);
    if (!artifact || artifact.businessId !== context.businessId) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Artifact unavailable in this business");
    return structuredClone(artifact);
  }

  readKnowledge(context: CommandContext): readonly KnowledgeFact[] {
    new AuthorityStore(this.#state.authority).requireBusiness(context);
    return structuredClone((this.#state.knowledge ?? []).filter(k => k.businessId === context.businessId));
  }

  readSource(context: CommandContext, sourceId: string): Source {
    new AuthorityStore(this.#state.authority).requireBusiness(context);
    const source = this.#state.sources?.find(s => s.id === sourceId);
    if (!source || source.businessId !== context.businessId) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Source unavailable in this business");
    return structuredClone(source);
  }

  async recordSource(context: CommandContext, input: { id: string; uri: string; content: string; contentType: string; retrievedAt: string; jobId?: JobId }): Promise<Source> {
    return this.#serialize(async () => {
      const provenance = this.#provenance(context, input.jobId);
      const existing = this.#state.sources?.find(s => s.id === input.id);
      if (existing) {
        this.readSource(context, input.id);
        for (const key of ["uri", "content", "contentType", "retrievedAt", "jobId"] as const) if (existing[key] !== input[key]) throw new RuntimeError("COMMAND_CONFLICT", "Source is immutable");
        return structuredClone(existing);
      }
      const source: Source = { ...input, ...provenance };
      await this.#save({ ...this.#state, sources: [...(this.#state.sources ?? []), source], facts: [...this.#state.facts,
        this.#fact(context, "source.recorded.v1", { sourceId: source.id, ...(source.jobId ? { jobId: source.jobId } : {}) })] });
      return structuredClone(source);
    });
  }

  async createArtifact(context: CommandContext, input: { id: string; jobId?: JobId; category: Artifact["category"]; contentType: string; content: unknown; sourceIds?: readonly string[]; references?: Artifact["references"] }): Promise<Artifact> {
    return this.#serialize(async () => {
      if (input.id.startsWith("job-output:")) throw new RuntimeError("INVALID_STATE", "Job outputs are created only by runtime completion");
      const provenance = this.#provenance(context, input.jobId);
      for (const id of input.sourceIds ?? []) this.readSource(context, id);
      for (const ref of input.references ?? []) {
        if (ref.businessId !== context.businessId) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Foreign artifact reference");
        this.readArtifact(context, ref.artifactId);
      }
      const record = { ...input, sourceIds: [...(input.sourceIds ?? [])], references: [...(input.references ?? [])] };
      const existing = this.#state.artifacts?.find(a => a.id === input.id);
      if (existing) {
        this.readArtifact(context, input.id);
        const { businessId: _b, createdAt: _d, correlationId: _c, actor: _a, producer: _p, agentId: _g, ...saved } = existing;
        if (commandFingerprint(saved) !== commandFingerprint(record)) throw new RuntimeError("COMMAND_CONFLICT", "Artifact is immutable");
        return structuredClone(existing);
      }
      const artifact: Artifact = { ...record, ...provenance };
      await this.#save({ ...this.#state, artifacts: [...(this.#state.artifacts ?? []), artifact], facts: [...this.#state.facts,
        this.#fact(context, "artifact.created.v1", { artifactId: artifact.id, category: artifact.category, ...(artifact.jobId ? { jobId: artifact.jobId } : {}) })] });
      return structuredClone(artifact);
    });
  }

  async recordKnowledge(context: CommandContext, input: { id: string; statement: string; jobId?: JobId; references: KnowledgeFact["references"] }): Promise<KnowledgeFact> {
    return this.#serialize(async () => {
      const provenance = this.#provenance(context, input.jobId);
      for (const ref of input.references) {
        if (ref.businessId !== context.businessId) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Foreign knowledge reference");
        this.readArtifact(context, ref.artifactId);
      }
      const existing = this.#state.knowledge?.find(k => k.id === input.id);
      if (existing) {
        if (existing.businessId !== context.businessId || existing.statement !== input.statement || existing.jobId !== input.jobId || commandFingerprint(existing.references) !== commandFingerprint(input.references)) throw new RuntimeError("COMMAND_CONFLICT", "Knowledge is immutable");
        return structuredClone(existing);
      }
      const fact: KnowledgeFact = { ...input, ...provenance, verification: "unverified" };
      await this.#save({ ...this.#state, knowledge: [...(this.#state.knowledge ?? []), fact], facts: [...this.#state.facts, this.#fact(context, "knowledge.recorded.v1", { knowledgeId: fact.id })] });
      return structuredClone(fact);
    });
  }

  async configureAgentTools(context: CommandContext, agentId: Agent["id"], toolIds: Agent["toolIds"]): Promise<Agent> {
    return this.#serialize(async () => {
      if (context.principal.kind !== "human") throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Only a human may configure permissions");
      const agent = new AuthorityStore(this.#state.authority).requireAgent(context, agentId);
      if (commandFingerprint(agent.toolIds) === commandFingerprint(toolIds)) return structuredClone(agent);
      if (this.#state.authority.jobs.some(j => j.agentId === agentId && j.status === "running")) throw new RuntimeError("INVALID_STATE", "Cannot change permissions while agent runs");
      const updated = { ...agent, toolIds: [...toolIds] };
      await this.#save({ ...this.#state, authority: { ...this.#state.authority, agents: this.#state.authority.agents.map(a => a.id === agentId ? updated : a) },
        facts: [...this.#state.facts, this.#fact(context, "agent.tools_configured.v1", { agentId, toolIds })] });
      return structuredClone(updated);
    });
  }

  jobInputs(context: CommandContext, jobId: JobId): readonly Artifact[] {
    const job = this.#job(context, jobId);
    const inputs = (job.inputArtifactIds ?? []).map(id => this.readArtifact(context, id));
    for (const upstreamId of job.dependsOn ?? []) {
      const upstream = this.#job(context, upstreamId);
      const outputs = this.#state.artifacts?.filter(a => a.businessId === context.businessId && a.jobId === upstreamId && a.id === `job-output:${upstreamId}`) ?? [];
      if (upstream.status !== "completed" || !outputs.length) throw new RuntimeError("INVALID_STATE", "Required upstream job/output is not completed");
      inputs.push(...structuredClone(outputs));
    }
    return inputs;
  }

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
      structuredClone(state),
    );
  }

  snapshot(): DurableState {
    return structuredClone(this.#state);
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
        ...this.#state,
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

      await this.#save(nextState);

      return result;
    });
  }

  async createJob(
    context: CommandContext,
    command: CreateJobCommand,
  ): Promise<JobResult> {
    return this.#serialize(async () => {
      for (const upstream of command.dependsOn ?? []) this.#job(context, upstream);
      for (const artifact of command.inputArtifactIds ?? []) this.readArtifact(context, artifact);
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
        ...this.#state,
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

      await this.#save(nextState);

      return result;
    });
  }

  inspectJob(context: CommandContext, jobId: JobId): Job {
    return structuredClone(this.#job(context, jobId));
  }

  inspectExecution(context: CommandContext, jobId: JobId): DurableExecution | undefined {
    this.#job(context, jobId);
    return structuredClone(this.#execution(jobId));
  }

  inspectApproval(context: CommandContext, approvalId: ApprovalId): DurableApproval {
    return structuredClone(this.#approval(context, approvalId));
  }

  inspectModelAccount(context: CommandContext, jobId: JobId): JobModelAccount | undefined {
    this.#job(context, jobId);
    return structuredClone(this.#state.modelAccounts?.find(a => a.jobId === jobId));
  }

  inspectLedger(context: CommandContext, jobId: JobId): readonly LedgerEntry[] {
    this.#job(context, jobId);
    return structuredClone((this.#state.ledger ?? []).filter(e => e.jobId === jobId));
  }

  inspectMeteredExpenses(context: CommandContext, jobId: JobId): readonly MeteredExpense[] {
    this.#job(context, jobId);
    return structuredClone((this.#state.meteredExpenses ?? []).filter(e => e.jobId === jobId));
  }

  async executeModelJob(context: CommandContext, jobId: JobId, provider: ModelProvider, tools: ToolRegistry,
    options: ModelExecutionOptions): Promise<ExecutionResult> {
    this.#job(context, jobId);
    const policy: ModelPolicy = structuredClone({ provider: provider.name, model: options.model,
      maxInputTokens: options.maxInputTokens, maxOutputTokens: options.maxOutputTokens,
      ...(options.pricing ? { pricing: options.pricing } : {}), ...(options.budget ? { budget: options.budget } : {}),
      ...(options.meteredPricing ? { meteredPricing: options.meteredPricing } : {}) });
    const existing = this.#state.modelAccounts?.find(a => a.jobId === jobId);
    if (existing && commandFingerprint(existing.policy) !== commandFingerprint(policy)) {
      throw new RuntimeError("COMMAND_CONFLICT", "Job model policy cannot change after admission");
    }
    const driver = new ModelDrivenAgentDriver(provider, tools, options,
      (request, signal) => this.#invokeModel(context, jobId, provider, policy, request, signal));
    return this.executeJob(context, jobId, driver, tools, options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns });
  }

  async #invokeModel(context: CommandContext, jobId: JobId, provider: ModelProvider, policy: ModelPolicy,
    request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const invocation = await this.#serialize(async () => {
      const job = this.#job(context, jobId);
      if (job.status !== "running" || signal?.aborted) throw new RuntimeError("INVALID_STATE", "Job is no longer running");
      if (policy.pricing) {
        try { validateModelPricing(policy.pricing); }
        catch { throw new RuntimeError("MODEL_CONFIGURATION_INVALID", "Model pricing configuration is invalid"); }
      }
      if (policy.pricing && policy.meteredPricing) throw new RuntimeError("MODEL_CONFIGURATION_INVALID", "Choose one explicit accounting scale");
      if (policy.meteredPricing) {
        try { validateMeteredPricing(policy.meteredPricing); }
        catch { throw new RuntimeError("MODEL_CONFIGURATION_INVALID", "Invalid nanodollar pricing"); }
      }
      const reservation = policy.pricing && maximumModelCost(provider.name, request.model, request.maxInputTokens, request.maxOutputTokens, policy.pricing);
      const meteredReservation = policy.meteredPricing && maximumMeteredCost(provider.name, request.model, request.maxInputTokens, request.maxOutputTokens, policy.meteredPricing);
      if (policy.budget && (typeof policy.budget.minorUnits !== "bigint" || policy.budget.minorUnits < 0n
        || (policy.meteredPricing ? !meteredReservation || policy.budget.currency !== "USD" : !reservation || reservation.currency !== policy.budget.currency))) {
        throw new RuntimeError("MODEL_CONFIGURATION_INVALID", "Hard budget requires matching exact pricing and currency");
      }
      const account = this.#state.modelAccounts?.find(a => a.jobId === jobId)
        ?? { jobId, businessId: context.businessId, policy, invocations: [] };
      if (commandFingerprint(account.policy) !== commandFingerprint(policy)) throw new RuntimeError("COMMAND_CONFLICT", "Job model policy cannot change");
      if (account.invocations.some(c => c.status !== "settled")) throw new RuntimeError("MODEL_USAGE_UNKNOWN", "Unsettled model invocation requires inspection");
      const committed = policy.meteredPricing
        ? modelMeteredTotals(account).spentNanodollars + modelMeteredTotals(account).reservedNanodollars
        : modelAccountTotals(account).spent + modelAccountTotals(account).reserved;
      const required = policy.meteredPricing ? meteredReservation?.nanodollars : reservation?.minorUnits;
      const limit = policy.budget && (policy.meteredPricing ? usdCentsToNanoUsd(policy.budget).nanodollars : policy.budget.minorUnits);
      if (limit !== undefined && committed + required! > limit) {
        throw new RuntimeError("MODEL_BUDGET_DENIED", "Model request reservation exceeds the job budget");
      }
      const call: ModelInvocation = { id: this.#ids.event(), status: "reserved", ...(reservation ? { reservation } : {}),
        ...(meteredReservation ? { meteredReservation } : {}) };
      await this.#saveModel({ ...account, invocations: [...account.invocations, call] });
      return call;
    });
    if (signal?.aborted) {
      // A saved reservation is conservative even when cancellation prevents dispatch.
      throw new RuntimeError("INVALID_STATE", "Job was cancelled before model dispatch");
    }
    let result: ModelResult;
    try { result = await provider.invoke(structuredClone(request), signal); }
    catch { result = { decision: { kind: "failure", code: "PROVIDER_FAILED" } }; }
    const normalized = normalizeModelUsage(result?.usage);
    const usage = normalized?.provider === provider.name ? normalized : undefined;
    const cost = usage && policy.pricing ? priceModelUsage(usage, policy.pricing) : undefined;
    const meteredCost = usage && policy.meteredPricing ? priceMeteredUsage(usage, policy.meteredPricing) : undefined;
    await this.#serialize(async () => {
      this.#job(context, jobId);
      const account = this.#state.modelAccounts!.find(a => a.jobId === jobId)!;
      const entry: LedgerEntry | undefined = cost ? {
        id: ids.ledgerEntry(this.#ids.event()), businessId: context.businessId, jobId, kind: "expense",
        amount: cost, description: "Model/API usage", occurredAt: this.#clock.now(),
      } : undefined;
      const meteredEntry: MeteredExpense | undefined = meteredCost ? {
        id: this.#ids.event(), businessId: context.businessId, jobId, invocationId: invocation.id,
        kind: "expense", cost: meteredCost, description: "Model/API usage", occurredAt: this.#clock.now(),
      } : undefined;
      const settled: ModelInvocation = { ...invocation,
        status: usage && ((!policy.pricing && !policy.meteredPricing) || cost || meteredCost) ? "settled" : "unknown",
        ...(usage ? { usage } : {}), ...(cost ? { cost } : {}), ...(entry ? { ledgerEntryId: entry.id } : {}),
        ...(meteredCost ? { meteredCost } : {}), ...(meteredEntry ? { meteredExpenseId: meteredEntry.id } : {}),
      };
      const facts: HQEvent[] = usage ? [this.#fact(context, "model.usage_recorded", { jobId, invocationId: invocation.id, ...usage })] : [];
      if (entry) facts.push(this.#fact(context, "ledger.entry_recorded", { entry }, facts[0]!.id));
      if (meteredEntry) {
        const { businessId: _businessId, ...payload } = meteredEntry;
        facts.push(this.#fact(context, "model.expense_recorded.v1", payload, facts[0]!.id));
      }
      await this.#saveModel({ ...account, invocations: account.invocations.map(c => c.id === invocation.id ? settled : c) }, entry, facts, meteredEntry);
    });
    if (policy.budget && (!usage || (!cost && !meteredCost))) {
      if (result?.decision?.kind === "failure") return result;
      throw new RuntimeError("MODEL_USAGE_UNKNOWN", "Model usage or price is unknown; reservation retained");
    }
    if (policy.budget && (usage!.inputTokens > policy.maxInputTokens || usage!.outputTokens > policy.maxOutputTokens
      || (policy.meteredPricing ? modelMeteredTotals(this.#state.modelAccounts!.find(a => a.jobId === jobId)!).spentNanodollars > usdCentsToNanoUsd(policy.budget).nanodollars
        : modelAccountTotals(this.#state.modelAccounts!.find(a => a.jobId === jobId)!).spent > policy.budget.minorUnits))) {
      throw new RuntimeError("MODEL_BUDGET_DENIED", "Provider exceeded the admitted request limits; actual cost recorded");
    }
    return result;
  }

  async #saveModel(account: JobModelAccount, entry?: LedgerEntry, facts: readonly HQEvent[] = [], meteredEntry?: MeteredExpense): Promise<void> {
    try {
      await this.#save({ ...this.#state,
        modelAccounts: [...(this.#state.modelAccounts ?? []).filter(a => a.jobId !== account.jobId), account],
        ledger: [...(this.#state.ledger ?? []), ...(entry ? [entry] : [])], facts: [...this.#state.facts, ...facts],
        ...(meteredEntry ? { meteredExpenses: [...(this.#state.meteredExpenses ?? []), meteredEntry] } : {}),
      });
    } catch { throw new PersistenceBoundaryError(); }
  }

  async executeJob(
    context: CommandContext,
    jobId: JobId,
    driver: AgentDriver,
    tools: ToolRegistry,
    options: { readonly maxTurns?: number } = {},
  ): Promise<ExecutionResult> {
    // Reserve in-process ownership before the first awaited durable transition.
    this.#job(context, jobId);
    if (this.#active.has(jobId)) throw new RuntimeError("INVALID_STATE", "Job execution is already active");
    const controller = new AbortController();
    this.#active.set(jobId, controller);
    try {
      // Validate the requested limit before publishing job.started.
      new ExecutionEngine(tools, options);
      const checkpoint = await this.#serialize(async () => {
        const job = this.#job(context, jobId);
        const fingerprint = commandFingerprint({ type: "executeJob", jobId, options });
        const existing = this.#findProcessedCommand(context, fingerprint);
        const current = this.#execution(jobId);
        if (current?.outcome && job.status !== "running") return current;
        if (job.status === "cancelled") return current;
        const store = new AuthorityStore(this.#state.authority);
        if (!job.agentId) throw new RuntimeError("INVALID_STATE", "Job needs an assigned agent");
        store.requireAgent(context, job.agentId);
        if (job.status === "queued") {
          this.jobInputs(context, jobId);
          const execution: DurableExecution = {
            jobId, businessId: context.businessId, agentId: job.agentId,
            turns: 0, observations: [], status: "running",
            maxTurns: options.maxTurns ?? 20,
          };
          const event = this.#fact(context, "job.started", { jobId, agentId: job.agentId });
          await this.#commitExecution(context, fingerprint, existing, { ...job, status: "running" }, execution, [event]);
          return execution;
        }
        if (!current || current.status !== "waiting_for_approval" || !current.operation || current.operation.dispatched) {
          throw new RuntimeError("INVALID_STATE", "Execution cannot be replayed safely; inspect the interrupted job");
        }
        const approval = current.operation.approvalId && this.#approval(context, current.operation.approvalId);
        if (!approval || approval.status !== "approved") return current;
        // The approved call is replayed from its durable input, never from the driver.
        await this.#commitExecution(context, fingerprint, existing, job, current, []);
        return current;
      });
      if (!checkpoint) return { status: "cancelled" };
      if (checkpoint.outcome) return structuredClone(checkpoint.outcome);
      if (checkpoint.status === "waiting_for_approval") {
        const approvalId = checkpoint.operation?.approvalId;
        if (!approvalId || this.#approval(context, approvalId).status !== "approved") {
          return { status: "waiting_for_approval" };
        }
      }
      const job = structuredClone(this.#job(context, jobId));
      const agent = structuredClone(new AuthorityStore(this.#state.authority).requireAgent(context, checkpoint.agentId));
      const engine = new ExecutionEngine(tools, { maxTurns: checkpoint.maxTurns });
      const inputs = this.jobInputs(context, jobId);
      const result = await engine.execute(job, agent, { next: turn => driver.next({ ...turn, inputs: structuredClone(inputs) }) }, {
        signal: controller.signal,
        observations: structuredClone(checkpoint.observations),
        turns: checkpoint.turns,
        ...(checkpoint.operation ? { pendingTool: structuredClone(checkpoint.operation.call) } : {}),
        beforeTool: (call, turns) => this.#serialize(async () => {
          const liveJob = this.#job(context, jobId);
          if (liveJob.status === "cancelled") { controller.abort(); return false; }
          const liveAgent = new AuthorityStore(this.#state.authority).requireAgent(context, checkpoint.agentId);
          if (!liveAgent.toolIds.includes(call.toolId)) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Tool permission was revoked");
          const current = this.#execution(jobId)!;
          const tool = tools.require(call.toolId);
          const savedOperation = current.operation;
          if (savedOperation?.dispatched) throw new RuntimeError("INVALID_STATE", "Operation was already dispatched");
          const operation = savedOperation ?? {
            id: ids.operation(this.#ids.event()), call: structuredClone(call), dispatched: false,
          };
          if (tool.definition.effect === "consequential") {
            const approval = operation.approvalId && this.#approval(context, operation.approvalId);
            if (!approval || approval.status !== "approved") {
              if (approval) return false;
              const requested: DurableApproval & { readonly status: "pending" } = {
                id: ids.approval(this.#ids.event()), businessId: context.businessId,
                operationId: operation.id, jobId, reason: `Execute consequential tool ${call.toolId}`, status: "pending",
                toolCall: structuredClone(operation.call),
              };
              await this.#save({
                ...this.#state,
                approvals: [...(this.#state.approvals ?? []), requested],
                executions: this.#replaceExecution({ ...current, turns, status: "waiting_for_approval", operation: { ...operation, approvalId: requested.id } }),
                facts: [...this.#state.facts, this.#fact(context, "approval.requested", { approval: {
                  id: requested.id, businessId: requested.businessId, operationId: requested.operationId,
                  jobId, reason: requested.reason, status: "pending",
                } })],
              });
              return false;
            }
          }
          await this.#save({ ...this.#state, executions: this.#replaceExecution({ ...current, turns, status: "running", operation: { ...operation, dispatched: true } }),
            facts: [...this.#state.facts, this.#fact(context, "tool.dispatched.v1", { jobId, agentId: checkpoint.agentId, operationId: operation.id, toolId: call.toolId })] });
          return true;
        }),
        afterTool: (call, toolResult) => this.#serialize(async () => {
          const current = this.#execution(jobId)!;
          const { operation: _operation, ...settled } = current;
          await this.#save({ ...this.#state, executions: this.#replaceExecution({
            ...settled, observations: [...current.observations, { toolId: call.toolId, result: structuredClone(toolResult) }],
          }), facts: [...this.#state.facts, this.#fact(context, "tool.completed.v1", { jobId, operationId: current.operation!.id, toolId: call.toolId })] });
        }),
      });
      return await this.#serialize(async () => {
        const liveJob = this.#job(context, jobId);
        if (liveJob.status === "cancelled") return { status: "cancelled" };
        if (result.status === "waiting_for_approval") return result;
        const current = this.#execution(jobId)!;
        const status = result.status;
        const event = status === "completed"
          ? this.#fact(context, "job.completed", { jobId })
          : status === "cancelled"
            ? this.#fact(context, "job.cancelled", { jobId })
            : this.#fact(context, "job.failed", { jobId, error: result.error ?? { code: "EXECUTION_FAILED", message: "Execution failed" } });
        const artifact: Artifact | undefined = status === "completed" ? {
          ...this.#provenance(context, jobId), id: `job-output:${jobId}`, category: typeof result.output === "string" ? "text" : "structured",
          contentType: typeof result.output === "string" ? "text/plain" : "application/json", content: structuredClone(result.output ?? null),
          sourceIds: [], references: [...this.jobInputs(context, jobId), ...(this.#state.artifacts ?? []).filter(a => a.jobId === jobId && a.businessId === context.businessId)].map(a => ({ businessId: context.businessId, artifactId: a.id })),
        } : undefined;
        await this.#save({
          ...this.#state,
          ...(artifact ? { artifacts: [...(this.#state.artifacts ?? []), artifact] } : {}),
          authority: { ...this.#state.authority, jobs: this.#state.authority.jobs.map(j => j.id === jobId ? { ...j, status } : j) },
          executions: this.#replaceExecution({ ...current, status, outcome: structuredClone(result) }),
          facts: [...this.#state.facts, event, ...(artifact ? [this.#fact(context, "artifact.created.v1", { artifactId: artifact.id, jobId, category: artifact.category }, event.id)] : [])],
        });
        return result;
      });
    } finally {
      this.#active.delete(jobId);
    }
  }

  async approveOperation(context: CommandContext, approvalId: ApprovalId): Promise<Approval> {
    return this.#decideApproval(context, approvalId, "approved", "");
  }

  async rejectOperation(context: CommandContext, approvalId: ApprovalId, reason: string): Promise<Approval> {
    return this.#decideApproval(context, approvalId, "rejected", reason);
  }

  async #decideApproval(context: CommandContext, approvalId: ApprovalId, status: "approved" | "rejected", reason: string): Promise<Approval> {
    return this.#serialize(async () => {
      if (context.principal.kind !== "human") throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Approval requires a trusted human principal");
      const approval = this.#approval(context, approvalId);
      const fingerprint = commandFingerprint({ type: status, approvalId, reason });
      const existing = this.#findProcessedCommand(context, fingerprint);
      if (existing) return structuredClone(approval);
      if (approval.status !== "pending" || !approval.jobId) throw new RuntimeError("INVALID_STATE", "Approval is no longer pending");
      const job = this.#job(context, approval.jobId);
      const execution = this.#execution(job.id);
      if (job.status !== "running" || execution?.operation?.id !== approval.operationId || execution.operation.dispatched) {
        throw new RuntimeError("INVALID_STATE", "Approval is not bound to an awaiting operation");
      }
      const next = { ...approval, status };
      const decision = status === "approved"
        ? this.#fact(context, "approval.granted", { approvalId, operationId: approval.operationId })
        : this.#fact(context, "approval.rejected", { approvalId, operationId: approval.operationId, reason });
      const facts: HQEvent[] = [decision];
      const outcome: ExecutionResult = { status: "failed", error: { code: "APPROVAL_REJECTED", message: reason || "Operation rejected" } };
      if (status === "rejected") facts.push(this.#fact(context, "job.failed", { jobId: job.id, error: outcome.error! }, decision.id));
      await this.#commitExecution(context, fingerprint, existing,
        status === "rejected" ? { ...job, status: "failed" } : job,
        status === "rejected" ? { ...execution, status: "failed", outcome } : execution,
        facts, (this.#state.approvals ?? []).map(a => a.id === approvalId ? next : a));
      return structuredClone(next);
    });
  }

  async cancelJob(context: CommandContext, jobId: JobId): Promise<Job> {
    return this.#serialize(async () => {
      const job = this.#job(context, jobId);
      const fingerprint = commandFingerprint({ type: "cancelJob", jobId });
      const existing = this.#findProcessedCommand(context, fingerprint);
      if (existing || job.status === "cancelled") return structuredClone(job);
      if (job.status !== "queued" && job.status !== "running") throw new RuntimeError("INVALID_STATE", "Terminal job cannot be cancelled");
      const execution = this.#execution(jobId);
      const cancelled: Job = { ...job, status: "cancelled" };
      await this.#commitExecution(context, fingerprint, existing, cancelled,
        execution ? { ...execution, status: "cancelled", outcome: { status: "cancelled" } } : undefined,
        [this.#fact(context, "job.cancelled", { jobId })],
        (this.#state.approvals ?? []).map(a => a.jobId === jobId && a.status === "pending" ? { ...a, status: "cancelled" } : a));
      this.#active.get(jobId)?.abort();
      return structuredClone(cancelled);
    });
  }

  #job(context: CommandContext, jobId: JobId): Job {
    return new AuthorityStore(this.#state.authority).requireJob(context, jobId);
  }

  #approval(context: CommandContext, approvalId: ApprovalId): DurableApproval {
    const approval = this.#state.approvals?.find(a => a.id === approvalId);
    if (!approval) throw new RuntimeError("INVALID_STATE", "Approval does not exist");
    if (approval.businessId !== context.businessId) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Approval belongs to another business");
    if (!approval.jobId) throw new RuntimeError("INVALID_STATE", "Approval has no job");
    this.#job(context, approval.jobId);
    return approval;
  }

  #execution(jobId: JobId): DurableExecution | undefined {
    return this.#state.executions?.find(e => e.jobId === jobId);
  }

  #replaceExecution(execution: DurableExecution): readonly DurableExecution[] {
    return [...(this.#state.executions ?? []).filter(e => e.jobId !== execution.jobId), execution];
  }

  #fact<Type extends HQEventType>(context: CommandContext, type: Type, payload: HQEventPayloadMap[Type], causationId = this.#state.facts.findLast(f => f.businessId === context.businessId)?.id ?? null): HQEvent<Type> {
    return { id: this.#ids.event(), type, occurredAt: this.#clock.now(), businessId: context.businessId,
      correlationId: context.correlationId, causationId,
      actor: { ...context.principal }, producer: "hq.runtime", payload: structuredClone(payload) } as HQEvent<Type>;
  }

  async #save(nextState: DurableState): Promise<void> {
    const detached = structuredClone(nextState);
    validateDurableState(detached);
    await this.#durableStore.save(detached);
    this.#state = detached;
    for (const listener of this.#listeners) { try { listener(); } catch { /* Observer failure cannot undo committed authority. */ } }
  }

  async #commitExecution(context: CommandContext, fingerprint: string, existing: ProcessedCommand | undefined, job: Job, execution: DurableExecution | undefined, facts: readonly HQEvent[], approvals = this.#state.approvals ?? []): Promise<void> {
    await this.#save({ ...this.#state,
      authority: { ...this.#state.authority, jobs: this.#state.authority.jobs.map(j => j.id === job.id ? job : j) },
      approvals,
      ...(execution ? { executions: this.#replaceExecution(execution) } : {}),
      facts: [...this.#state.facts, ...facts],
      processedCommands: existing ? this.#state.processedCommands : [...this.#state.processedCommands, {
        commandId: context.commandId, businessId: context.businessId, inputFingerprint: fingerprint,
        eventIds: facts.map(f => f.id), result: { kind: "job", recordId: job.id },
      }],
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
