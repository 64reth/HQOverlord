import type { BusinessId } from "@hqoverlord/core";
import type { CorrelationId } from "@hqoverlord/events";

/**
 * Identifies the principal that caused a command.
 *
 * Authentication happens outside this type. Runtime receives an already
 * established principal and uses this context when enforcing authority
 * and recording provenance.
 */
export type Principal =
  | {
      readonly kind: "human";
      readonly id: string;
    }
  | {
      readonly kind: "agent";
      readonly id: string;
    }
  | {
      readonly kind: "system";
      readonly id: string;
    };

declare const commandIdBrand: unique symbol;

export type CommandId = string & {
  readonly [commandIdBrand]: "CommandId";
};

export function commandId(value: string): CommandId {
  if (value.trim().length === 0) {
    throw new Error("CommandId cannot be empty");
  }

  return value as CommandId;
}

/**
 * Trusted metadata attached by the HQ boundary to every command.
 *
 * businessId identifies the isolation boundary in which the caller is
 * authorised to act. Commands must not use caller-supplied record scope
 * as proof of authority.
 */
export interface CommandContext {
  readonly commandId: CommandId;
  readonly principal: Principal;
  readonly businessId: BusinessId;
  readonly correlationId: CorrelationId;
}
