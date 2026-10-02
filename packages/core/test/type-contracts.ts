// Compile-time regression checks, validated by npm run typecheck; never executed.
import { currencyCode, ids, money } from "../src/index.ts";
import type { Agent, AgentId, ApprovalId, BusinessId, Job, JobId, LedgerEntryId, Money, ToolId, WorkflowId } from "../src/index.ts";

type Expect<Condition extends true> = Condition;
type DistinctFromRest<Head, Rest extends readonly unknown[]> =
  Rest extends readonly [infer Next, ...infer Tail]
    ? [Head] extends [Next] ? false : DistinctFromRest<Head, Tail>
    : true;
type PairwiseDistinct<Ids extends readonly unknown[]> =
  Ids extends readonly [infer Head, ...infer Rest]
    ? DistinctFromRest<Head, Rest> extends true ? PairwiseDistinct<Rest> : false
    : true;
export type DomainIdsAreDistinct = Expect<PairwiseDistinct<[
  BusinessId, AgentId, ToolId, JobId, WorkflowId, ApprovalId, LedgerEntryId,
]>>;

export function checkContracts(agent: Agent, job: Job): void {
  const businessId: BusinessId = agent.businessId;
  const jobBusinessId: BusinessId = job.businessId;
  void [businessId, jobBusinessId];
  // @ts-expect-error Domain identifiers must not be interchangeable.
  const wrongBusiness: BusinessId = ids.agent("agent-1");
  // @ts-expect-error Arbitrary strings are not domain identifiers.
  const unbranded: JobId = "job-1";
  // @ts-expect-error Every Agent must belong to exactly one Business.
  const unscopedAgent: Agent = { id: ids.agent("a"), name: "Agent", status: "idle", capabilities: [], toolIds: [] };
  // @ts-expect-error Every Job must belong to exactly one Business.
  const unscopedJob: Job = { id: ids.job("j"), objective: "Work", status: "queued" };
  // @ts-expect-error Floating-point money is not part of the contract.
  const floatingMoney: Money = { minorUnits: 12.34, currency: currencyCode("GBP") };
  // @ts-expect-error The constructor also rejects number inputs statically.
  money(1234, currencyCode("GBP"));
  // @ts-expect-error The shared TypeScript configuration excludes browser globals.
  document.createElement("div");
  void [wrongBusiness, unbranded, unscopedAgent, unscopedJob, floatingMoney];
}
