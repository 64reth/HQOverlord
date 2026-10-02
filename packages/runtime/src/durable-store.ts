import type { DurableState } from "./durable-state.ts";

export interface DurableStore {
  load(): Promise<DurableState>;
  save(state: DurableState): Promise<void>;
}
