import type { HQEvent } from "@hqoverlord/events";

import type {
  AuthoritySnapshot,
} from "./authority-store.ts";

export const DURABLE_STATE_VERSION = 1 as const;

export type ProcessedCommandResult =
  | {
      readonly kind: "agent";
      readonly recordId: string;
    }
  | {
      readonly kind: "job";
      readonly recordId: string;
    };

export interface ProcessedCommand {
  readonly commandId: string;
  readonly businessId: string;

  /**
   * Stable representation of the successful command input.
   * Reusing a command ID with different input is a conflict.
   */
  readonly inputFingerprint: string;

  readonly eventIds: readonly string[];
  readonly result: ProcessedCommandResult;
}

export interface DurableState {
  readonly version: typeof DURABLE_STATE_VERSION;
  readonly authority: AuthoritySnapshot;
  readonly facts: readonly HQEvent[];
  readonly processedCommands: readonly ProcessedCommand[];
}

export function emptyDurableState(): DurableState {
  return {
    version: DURABLE_STATE_VERSION,
    authority: {
      businesses: [],
      agents: [],
      jobs: [],
    },
    facts: [],
    processedCommands: [],
  };
}
