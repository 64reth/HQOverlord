import type {
  Agent,
  AgentId,
  Business,
  BusinessId,
  Job,
  JobId,
} from "@hqoverlord/core";

import type { CommandContext } from "./command-context.ts";
import { RuntimeError } from "./runtime-error.ts";

export interface AuthoritySnapshot {
  readonly businesses: readonly Business[];
  readonly agents: readonly Agent[];
  readonly jobs: readonly Job[];
}

/**
 * Business-scoped canonical runtime state.
 *
 * Snapshot/restore exists so persistence can perform work against an
 * isolated copy and publish it only after the durable commit succeeds.
 */
export class AuthorityStore {
  readonly #businesses = new Map<BusinessId, Business>();
  readonly #agents = new Map<AgentId, Agent>();
  readonly #jobs = new Map<JobId, Job>();

  constructor(snapshot?: AuthoritySnapshot) {
    if (snapshot !== undefined) {
      for (const business of snapshot.businesses) {
        this.#businesses.set(business.id, business);
      }

      for (const agent of snapshot.agents) {
        this.#agents.set(agent.id, agent);
      }

      for (const job of snapshot.jobs) {
        this.#jobs.set(job.id, job);
      }
    }
  }

  snapshot(): AuthoritySnapshot {
    return {
      businesses: [...this.#businesses.values()],
      agents: [...this.#agents.values()],
      jobs: [...this.#jobs.values()],
    };
  }

  clone(): AuthorityStore {
    return new AuthorityStore(this.snapshot());
  }

  addBusiness(business: Business): void {
    this.#businesses.set(business.id, business);
  }

  addAgent(agent: Agent): void {
    this.#agents.set(agent.id, agent);
  }

  addJob(job: Job): void {
    this.#jobs.set(job.id, job);
  }

  requireBusiness(context: CommandContext): Business {
    const business = this.#businesses.get(context.businessId);

    if (!business) {
      throw new RuntimeError(
        "BUSINESS_NOT_FOUND",
        `Business ${context.businessId} does not exist`,
      );
    }

    return business;
  }

  requireAgent(context: CommandContext, agentId: AgentId): Agent {
    this.requireBusiness(context);

    const agent = this.#agents.get(agentId);

    if (!agent) {
      throw new RuntimeError(
        "AGENT_NOT_FOUND",
        `Agent ${agentId} does not exist`,
      );
    }

    if (agent.businessId !== context.businessId) {
      throw new RuntimeError(
        "BUSINESS_SCOPE_VIOLATION",
        "Agent does not belong to the authorised business",
      );
    }

    return agent;
  }

  requireJob(context: CommandContext, jobId: JobId): Job {
    this.requireBusiness(context);

    const job = this.#jobs.get(jobId);

    if (!job) {
      throw new RuntimeError(
        "JOB_NOT_FOUND",
        `Job ${jobId} does not exist`,
      );
    }

    if (job.businessId !== context.businessId) {
      throw new RuntimeError(
        "BUSINESS_SCOPE_VIOLATION",
        "Job does not belong to the authorised business",
      );
    }

    return job;
  }

  listAgents(context: CommandContext): readonly Agent[] {
    this.requireBusiness(context);

    return [...this.#agents.values()].filter(
      (agent) => agent.businessId === context.businessId,
    );
  }

  listJobs(context: CommandContext): readonly Job[] {
    this.requireBusiness(context);

    return [...this.#jobs.values()].filter(
      (job) => job.businessId === context.businessId,
    );
  }
}
