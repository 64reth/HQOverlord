import {
  mkdir,
  readFile,
  rename,
  rm,
  open,
} from "node:fs/promises";

import { dirname } from "node:path";

import type { DurableStore } from "./durable-store.ts";

import {
  decodeDurableState,
  encodeDurableState,
} from "./durable-state-codec.ts";

import {
  emptyDurableState,
  type DurableState,
} from "./durable-state.ts";

export class FileDurableStore implements DurableStore {
  readonly #path: string;

  constructor(path: string) {
    if (path.trim().length === 0) {
      throw new TypeError("Durable store path must not be empty");
    }

    this.#path = path;
  }

  async load(): Promise<DurableState> {
    try {
      const serialized = await readFile(this.#path, "utf8");
      return decodeDurableState(serialized);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyDurableState();
      }

      throw error;
    }
  }

  async save(state: DurableState): Promise<void> {
    const temporaryPath = `${this.#path}.tmp`;

    await mkdir(dirname(this.#path), {
      recursive: true,
    });

    try {
      const file = await open(temporaryPath, "w", 0o600);
      try { await file.writeFile(encodeDurableState(state), "utf8"); await file.sync(); }
      finally { await file.close(); }

      await rename(temporaryPath, this.#path);
      try {
        const directory = await open(dirname(this.#path), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } catch { /* Directory fsync is unsupported on Windows. */ }
    } catch (error: unknown) {
      await rm(temporaryPath, {
        force: true,
      }).catch(() => undefined);

      throw error;
    }
  }
}



