import type { DurableState } from "./durable-state.ts";
import { DURABLE_STATE_VERSION } from "./durable-state.ts";

const BIGINT_TAG = "$hq.bigint";

interface EncodedBigInt {
  readonly [BIGINT_TAG]: string;
}

function isEncodedBigInt(value: unknown): value is EncodedBigInt {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    Object.keys(record).length === 1 &&
    typeof record[BIGINT_TAG] === "string" &&
    /^(0|-?[1-9][0-9]*)$/.test(record[BIGINT_TAG])
  );
}

export function encodeDurableState(state: DurableState): string {
  return JSON.stringify(
    state,
    (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return {
          [BIGINT_TAG]: value.toString(10),
        };
      }

      return value;
    },
    2,
  );
}

export function decodeDurableState(serialized: string): DurableState {
  const value = JSON.parse(
    serialized,
    (_key, parsed: unknown) => {
      if (isEncodedBigInt(parsed)) {
        return BigInt(parsed[BIGINT_TAG]);
      }

      return parsed;
    },
  ) as unknown;

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Durable state must be an object");
  }

  const candidate = value as Partial<DurableState>;

  if (candidate.version !== DURABLE_STATE_VERSION) {
    throw new TypeError(
      `Unsupported durable state version: ${String(candidate.version)}`,
    );
  }

  if (
    candidate.authority === undefined ||
    !Array.isArray(candidate.facts) ||
    !Array.isArray(candidate.processedCommands)
  ) {
    throw new TypeError("Durable state is missing required sections");
  }

  return candidate as DurableState;
}
