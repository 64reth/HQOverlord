import type { ToolId } from "@hqoverlord/core";
import type { AgentAction } from "./execution-contracts.ts";

export interface ModelUsage {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly requestId?: string;
}

export interface ModelToolDefinition {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly tools: readonly ModelToolDefinition[];
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export type ModelDecision = AgentAction | {
  readonly kind: "failure";
  readonly code: "PROVIDER_FAILED" | "MODEL_CONFIGURATION_INVALID" | "MODEL_INPUT_LIMIT" | "MODEL_DECISION_INVALID";
};

export interface ModelResult {
  readonly decision: ModelDecision;
  /** Absent means unknown, never zero. Usage can accompany a failed decision. */
  readonly usage?: ModelUsage;
}

export interface ModelProvider {
  readonly name: string;
  /** Implementations must enforce both request limits before/while generating. No automatic retries. */
  invoke(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
}

export function validModelUsage(value: unknown): value is ModelUsage {
  if (!value || typeof value !== "object") return false;
  const u = value as ModelUsage;
  const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  return typeof u.provider === "string" && u.provider.length > 0 && typeof u.model === "string" && u.model.length > 0
    && count(u.inputTokens) && count(u.outputTokens)
    && (u.cachedInputTokens === undefined || (count(u.cachedInputTokens) && u.cachedInputTokens <= u.inputTokens))
    && (u.requestId === undefined || typeof u.requestId === "string");
}

/** Select only HQ fields, even when an adapter returns extra provider data at runtime. */
export function normalizeModelUsage(value: unknown): ModelUsage | undefined {
  if (!validModelUsage(value)) return undefined;
  return { provider: value.provider, model: value.model, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    ...(value.cachedInputTokens !== undefined ? { cachedInputTokens: value.cachedInputTokens } : {}),
    ...(value.requestId !== undefined ? { requestId: value.requestId } : {}),
  };
}

