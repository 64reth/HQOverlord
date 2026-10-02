import type { ToolId } from "./ids.ts";

export type ToolEffect = "read_only" | "consequential";

/** A host-available executable capability; availability is not permission to execute. */
export interface Tool {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly effect: ToolEffect;
}
