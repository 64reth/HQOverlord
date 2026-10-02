declare const idBrand: unique symbol;

/** Opaque identifiers; construct only at a trusted ingestion or creation boundary. */
export type Id<Domain extends string> = string & { readonly [idBrand]: Domain };

export type BusinessId = Id<"Business">;
export type AgentId = Id<"Agent">;
export type ToolId = Id<"Tool">;
export type JobId = Id<"Job">;
export type WorkflowId = Id<"Workflow">;
export type ApprovalId = Id<"Approval">;
export type LedgerEntryId = Id<"LedgerEntry">;
export type OperationId = Id<"Operation">;

function identifier<Domain extends string>(value: string): Id<Domain> {
  if (value.trim().length === 0) throw new TypeError("An identifier must not be empty");
  return value as Id<Domain>;
}

/** Branding does not establish existence, uniqueness, ownership, or authority. */
export const ids = {
  business: (value: string): BusinessId => identifier<"Business">(value),
  agent: (value: string): AgentId => identifier<"Agent">(value),
  tool: (value: string): ToolId => identifier<"Tool">(value),
  job: (value: string): JobId => identifier<"Job">(value),
  workflow: (value: string): WorkflowId => identifier<"Workflow">(value),
  approval: (value: string): ApprovalId => identifier<"Approval">(value),
  ledgerEntry: (value: string): LedgerEntryId => identifier<"LedgerEntry">(value),
  operation: (value: string): OperationId => identifier<"Operation">(value),
} as const;
