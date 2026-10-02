import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { FileDurableStore, systemClock, systemIds } from "@hqoverlord/runtime";
import { loadBusiness001 } from "./load.ts";

const directory = await mkdtemp(join(tmpdir(), "hq-business-001-preview-"));
try {
  const loaded = await loadBusiness001(new FileDurableStore(join(directory, "state.json")), systemClock, systemIds);
  console.log(JSON.stringify({ business: loaded.manifest.identity, agents: loaded.agents, firstJob: loaded.firstJob,
    mission: loaded.manifest.mission, budgets: loaded.manifest.budgets, authority: loaded.manifest.authority },
    (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2));
  console.log("CONFIGURATION PREVIEW: loaded five generic agents; no model/network call, customer or revenue created.");
} finally {
  if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("hq-business-001-preview-")) throw new Error("Unexpected preview cleanup path");
  await rm(directory, { recursive: true, force: true });
}
