export type RuntimeErrorCode =
  | "BUSINESS_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "BUSINESS_SCOPE_VIOLATION"
  | "INVALID_STATE"
  | "COMMAND_CONFLICT"
  | "PROVIDER_FAILED"
  | "MODEL_CONFIGURATION_INVALID"
  | "MODEL_INPUT_LIMIT"
  | "MODEL_DECISION_INVALID"
  | "MODEL_USAGE_UNKNOWN"
  | "MODEL_BUDGET_DENIED";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}

/** A failed durable boundary must propagate, never be published as a terminal outcome. */
export class PersistenceBoundaryError extends Error {
  constructor() { super("Model accounting persistence failed; inspect the interrupted job"); }
}
