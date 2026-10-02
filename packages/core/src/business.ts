import type { BusinessId } from "./ids.ts";

export type BusinessStatus = "active" | "paused" | "archived";

/** Top-level operational isolation boundary. Timestamps are UTC ISO 8601 strings. */
export interface Business {
  readonly id: BusinessId;
  readonly name: string;
  readonly status: BusinessStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
