export type RuntimeErrorCode =
  | "BUSINESS_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "BUSINESS_SCOPE_VIOLATION"
  | "INVALID_STATE"
  | "COMMAND_CONFLICT";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}
