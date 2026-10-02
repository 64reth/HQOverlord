import { ids } from "@hqoverlord/core";
import { validModelUsage, type ModelProvider, type ModelRequest, type ModelResult, type ModelUsage } from "./model-provider.ts";
import type { AgentObservation } from "./execution-contracts.ts";

export interface OpenAIProviderDiagnostic {
  readonly stage: "configuration" | "continuation" | "input_tokens" | "response" | "parse";
  readonly category: "http_error" | "network_error" | "cancelled" | "timeout" | "invalid_response" | "invalid_continuation" | "invalid_configuration";
  readonly httpStatus?: number;
  readonly errorCode?: string;
  readonly errorType?: string;
  readonly parameter?: string;
}

interface Conversation {
  readonly signature: string;
  readonly history: readonly unknown[];
  readonly observations: readonly AgentObservation[];
  readonly pending: { readonly callId: string; readonly toolId: string };
}

const json = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;

export interface OpenAIModelProviderOptions {
  readonly apiKey?: string;
  readonly transport?: typeof fetch;
  readonly timeoutMs?: number;
  /** Selected metadata only. No raw errors, messages, bodies or headers are forwarded. */
  readonly onDiagnostic?: (diagnostic: OpenAIProviderDiagnostic) => void;
}

/** Responses REST adapter. Credentials and provider response shapes never enter HQ state. */
export class OpenAIModelProvider implements ModelProvider {
  readonly name = "openai";
  readonly #apiKey: string;
  readonly #transport: typeof fetch;
  readonly #timeoutMs: number;
  readonly #onDiagnostic: OpenAIModelProviderOptions["onDiagnostic"];
  readonly #conversations = new Map<string, Conversation>();
  readonly #active = new Set<string>();

  constructor(options: OpenAIModelProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.#transport = options.transport ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#onDiagnostic = options.onDiagnostic;
  }

  async invoke(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const id = request.context?.conversationId;
    if (id && this.#active.has(id)) {
      this.#diagnostic({ stage: "continuation", category: "invalid_continuation" });
      return { decision: { kind: "failure", code: "MODEL_DECISION_INVALID" } };
    }
    if (id) this.#active.add(id);
    try { return await this.#invoke(request, signal); }
    finally { if (id) this.#active.delete(id); }
  }

  async #invoke(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const id = request.context?.conversationId;
    let stage: OpenAIProviderDiagnostic["stage"] = "configuration";
    const failure = (code: "PROVIDER_FAILED" | "MODEL_CONFIGURATION_INVALID" | "MODEL_INPUT_LIMIT" | "MODEL_DECISION_INVALID",
      usage?: ModelUsage): ModelResult => {
        if (id) this.#conversations.delete(id);
        if (stage === "parse" && code === "MODEL_DECISION_INVALID") this.#diagnostic({ stage, category: "invalid_response" });
        return { decision: { kind: "failure", code }, ...(usage ? { usage } : {}) };
      };
    if (!this.#apiKey.trim() || !request.model.trim() || ![request.maxInputTokens, request.maxOutputTokens, this.#timeoutMs]
      .every(n => Number.isSafeInteger(n) && n > 0)) {
      this.#diagnostic({ stage, category: "invalid_configuration" });
      return failure("MODEL_CONFIGURATION_INVALID");
    }
    try {
      const tools = request.tools.map((tool, index) => ({ type: "function", name: `hq_tool_${index}`,
        description: tool.description, parameters: tool.inputSchema, strict: false }));
      const signature = json({ model: request.model, instructions: request.instructions, tools });
      const previous = id ? this.#conversations.get(id) : undefined;
      const observations = request.context?.observations ?? [];
      let history: readonly unknown[] = [{ role: "user", content: request.input }];
      if (id) {
        stage = "continuation";
        if (previous) {
          const observation = observations.at(-1);
          if (previous.signature !== signature || observations.length !== previous.observations.length + 1
            || json(observations.slice(0, -1)) !== json(previous.observations) || observation?.toolId !== previous.pending.toolId) {
            this.#diagnostic({ stage, category: "invalid_continuation" });
            return failure("MODEL_DECISION_INVALID");
          }
          history = [...previous.history, { type: "function_call_output", call_id: previous.pending.callId,
            output: json(observation.result.output) }];
        } else if (observations.length) {
          // No guessing call IDs after adapter loss/restart. Existing HQ interrupted-run safety still applies.
          this.#diagnostic({ stage, category: "invalid_continuation" });
          return failure("MODEL_DECISION_INVALID");
        }
      }
      const input = { model: request.model, instructions: request.instructions, input: id ? history : request.input, tools };
      // Refuse accidental credential placement in model content, including configured tool schemas.
      if (JSON.stringify(input).includes(this.#apiKey)) return failure("MODEL_CONFIGURATION_INVALID");
      const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]) : AbortSignal.timeout(this.#timeoutMs);
      if (abort.aborted) return failure("PROVIDER_FAILED");
      stage = "input_tokens";
      const countResponse = await this.#post("input_tokens", input, abort);
      if (!countResponse.ok) { await this.#httpDiagnostic(stage, countResponse); return failure("PROVIDER_FAILED"); }
      const count = record(await countResponse.json())?.input_tokens;
      if (!Number.isSafeInteger(count) || (count as number) < 0) return failure("PROVIDER_FAILED");
      if ((count as number) > request.maxInputTokens) return failure("MODEL_INPUT_LIMIT");
      if (abort.aborted) return failure("PROVIDER_FAILED");
      stage = "response";
      const response = await this.#post("", { ...input, max_output_tokens: request.maxOutputTokens,
        parallel_tool_calls: false, store: false, truncation: "disabled", include: ["reasoning.encrypted_content"] }, abort);
      let raw: RecordValue | undefined;
      try { raw = record(await response.json()); }
      catch {
        if (!response.ok) this.#httpFields(stage, response.status);
        else this.#diagnostic({ stage: "parse", category: "invalid_response", httpStatus: response.status });
        return failure("PROVIDER_FAILED");
      }
      const rawUsage = record(raw?.usage);
      const details = record(rawUsage?.input_tokens_details);
      const candidate = {
        provider: this.name, model: typeof raw?.model === "string" ? raw.model : request.model,
        inputTokens: rawUsage?.input_tokens, outputTokens: rawUsage?.output_tokens,
        ...(details?.cached_tokens !== undefined ? { cachedInputTokens: details.cached_tokens } : {}),
        ...(typeof raw?.id === "string" ? { requestId: raw.id } : {}),
      };
      // Only selected scalar fields survive; never retain server errors/headers/raw bodies.
      const usage = validModelUsage(candidate) ? this.#clean(candidate) : undefined;
      if (!response.ok) { this.#httpFields(stage, response.status, raw); return failure("PROVIDER_FAILED", usage); }
      stage = "parse";
      if (raw?.status !== "completed" || !Array.isArray(raw.output)) return failure("MODEL_DECISION_INVALID", usage);
      const output = raw.output.map(record);
      if (output.some(item => !item || !["reasoning", "function_call", "message"].includes(item.type as string))) {
        return failure("MODEL_DECISION_INVALID", usage);
      }
      const calls = output.filter(item => item?.type === "function_call");
      if (calls.length === 1) {
        const call = calls[0]!;
        const index = tools.findIndex(tool => tool.name === call.name);
        const tool = request.tools[index];
        if (!tool || typeof call.arguments !== "string") return failure("MODEL_DECISION_INVALID", usage);
        let args: unknown;
        try { args = JSON.parse(call.arguments); }
        catch { return failure("MODEL_DECISION_INVALID", usage); }
        if (!record(args)) return failure("MODEL_DECISION_INVALID", usage);
        if (id) {
          if (typeof call.call_id !== "string" || !call.call_id || previous?.history.some(item => record(item)?.call_id === call.call_id)) {
            this.#diagnostic({ stage, category: "invalid_continuation" });
            return failure("MODEL_DECISION_INVALID", usage);
          }
          // Preserve every output item (including encrypted reasoning) with its exact call linkage.
          this.#conversations.set(id, { signature, history: [...history, ...this.#clean(raw.output)],
            observations: structuredClone(observations), pending: { callId: call.call_id, toolId: tool.id } });
        }
        return { decision: { kind: "tool", toolId: ids.tool(tool.id), input: this.#clean(args) }, ...(usage ? { usage } : {}) };
      }
      if (calls.length > 1) return failure("MODEL_DECISION_INVALID", usage);
      const messages = output.filter(item => item?.type === "message");
      const texts: string[] = [];
      for (const message of messages) {
        if (message?.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content)) return failure("MODEL_DECISION_INVALID", usage);
        for (const content of message.content) {
          const item = record(content);
          if (item?.type !== "output_text" || typeof item.text !== "string") return failure("MODEL_DECISION_INVALID", usage);
          texts.push(item.text);
        }
      }
      if (!texts.length) return failure("MODEL_DECISION_INVALID", usage);
      if (id) this.#conversations.delete(id);
      return { decision: { kind: "complete", output: this.#clean(texts.join("\n")) }, ...(usage ? { usage } : {}) };
    } catch (error: unknown) {
      // Network/client exceptions may include Authorization or the request. Never forward them.
      this.#diagnostic({ stage, category: signal?.aborted ? "cancelled"
        : error instanceof Error && error.name === "TimeoutError" ? "timeout"
        : error instanceof SyntaxError ? "invalid_response" : "network_error" });
      return failure("PROVIDER_FAILED");
    }
  }

  #diagnostic(diagnostic: OpenAIProviderDiagnostic): void {
    try { this.#onDiagnostic?.({ ...diagnostic }); } catch { /* Observers cannot change provider outcomes. */ }
  }

  async #httpDiagnostic(stage: OpenAIProviderDiagnostic["stage"], response: Response): Promise<void> {
    let raw: unknown;
    try { raw = await response.json(); } catch { /* Status remains useful without a JSON body. */ }
    this.#httpFields(stage, response.status, record(raw));
  }

  #httpFields(stage: OpenAIProviderDiagnostic["stage"], status: number, raw?: RecordValue): void {
    const error = record(raw?.error);
    const safe = (value: unknown, allowed: readonly string[]) => typeof value === "string" && allowed.includes(value)
      && !value.includes(this.#apiKey) ? value : "unrecognized";
    this.#diagnostic({ stage, category: "http_error", httpStatus: status,
      errorCode: safe(error?.code, ["rate_limit_exceeded", "insufficient_quota", "invalid_api_key", "model_not_found", "invalid_request_error", "context_length_exceeded", "unsupported_parameter", "server_error"]),
      errorType: safe(error?.type, ["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "server_error", "insufficient_quota"]),
      parameter: safe(error?.param, ["input", "tools", "model", "previous_response_id", "max_output_tokens", "instructions", "include"]),
    });
  }

  #post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    return this.#transport(`https://api.openai.com/v1/responses${path ? `/${path}` : ""}`, {
      method: "POST", headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal, redirect: "error",
    });
  }

  #clean<T>(value: T): T {
    const scrub = (item: unknown): unknown => {
      if (typeof item === "string") return item.split(this.#apiKey).join("[REDACTED]");
      if (Array.isArray(item)) return item.map(scrub);
      const obj = record(item);
      return obj ? Object.fromEntries(Object.entries(obj).map(([key, v]) => [key.split(this.#apiKey).join("[REDACTED]"), scrub(v)])) : item;
    };
    return scrub(value) as T;
  }
}
