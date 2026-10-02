import type { ModelProvider, ModelRequest, ModelResult } from "./model-provider.ts";

/** Scripted results are explicit: the fake does not fabricate usage for omitted records. */
export class FakeModelProvider implements ModelProvider {
  readonly name = "fake";
  readonly requests: ModelRequest[] = [];
  readonly #results: readonly ModelResult[];
  constructor(results: readonly ModelResult[]) { this.#results = structuredClone(results); }
  async invoke(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted) return { decision: { kind: "failure", code: "PROVIDER_FAILED" } };
    const index = this.requests.length;
    this.requests.push(structuredClone(request));
    const result = this.#results[index];
    if (!result) return { decision: { kind: "failure", code: "PROVIDER_FAILED" } };
    if (result.usage && (result.usage.inputTokens > request.maxInputTokens || result.usage.outputTokens > request.maxOutputTokens)) {
      return { decision: { kind: "failure", code: "MODEL_INPUT_LIMIT" } };
    }
    return structuredClone(result);
  }
}
