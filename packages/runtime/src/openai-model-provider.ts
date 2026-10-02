import { ids } from "@hqoverlord/core";
import { validModelUsage, type ModelProvider, type ModelRequest, type ModelResult, type ModelUsage } from "./model-provider.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;

export interface OpenAIModelProviderOptions {
  readonly apiKey?: string;
  readonly transport?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Responses REST adapter. Credentials and provider response shapes never enter HQ state. */
export class OpenAIModelProvider implements ModelProvider {
  readonly name = "openai";
  readonly #apiKey: string;
  readonly #transport: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: OpenAIModelProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.#transport = options.transport ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
  }

  async invoke(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    const failure = (code: "PROVIDER_FAILED" | "MODEL_CONFIGURATION_INVALID" | "MODEL_INPUT_LIMIT" | "MODEL_DECISION_INVALID",
      usage?: ModelUsage): ModelResult => ({ decision: { kind: "failure", code }, ...(usage ? { usage } : {}) });
    if (!this.#apiKey.trim() || !request.model.trim() || ![request.maxInputTokens, request.maxOutputTokens, this.#timeoutMs]
      .every(n => Number.isSafeInteger(n) && n > 0)) return failure("MODEL_CONFIGURATION_INVALID");
    try {
      const tools = request.tools.map((tool, index) => ({ type: "function", name: `hq_tool_${index}`,
        description: tool.description, parameters: tool.inputSchema, strict: false }));
      const input = { model: request.model, instructions: request.instructions, input: request.input, tools };
      // Refuse accidental credential placement in model content, including configured tool schemas.
      if (JSON.stringify(input).includes(this.#apiKey)) return failure("MODEL_CONFIGURATION_INVALID");
      const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]) : AbortSignal.timeout(this.#timeoutMs);
      if (abort.aborted) return failure("PROVIDER_FAILED");
      const countResponse = await this.#post("input_tokens", input, abort);
      if (!countResponse.ok) return failure("PROVIDER_FAILED");
      const count = record(await countResponse.json())?.input_tokens;
      if (!Number.isSafeInteger(count) || (count as number) < 0) return failure("PROVIDER_FAILED");
      if ((count as number) > request.maxInputTokens) return failure("MODEL_INPUT_LIMIT");
      if (abort.aborted) return failure("PROVIDER_FAILED");
      const response = await this.#post("", { ...input, max_output_tokens: request.maxOutputTokens,
        parallel_tool_calls: false, store: false, truncation: "disabled" }, abort);
      const raw = record(await response.json());
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
      if (!response.ok) return failure("PROVIDER_FAILED", usage);
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
      return { decision: { kind: "complete", output: this.#clean(texts.join("\n")) }, ...(usage ? { usage } : {}) };
    } catch {
      // Network/client exceptions may include Authorization or the request. Never forward them.
      return failure("PROVIDER_FAILED");
    }
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
