import { fileURLToPath } from "node:url";
import { FileDurableStore, systemClock, systemIds } from "@hqoverlord/runtime";
import { loadBusiness001 } from "./load.ts";

const path = fileURLToPath(new URL(".local/state.json", import.meta.url));
const loaded = await loadBusiness001(new FileDurableStore(path), systemClock, systemIds);
console.log(`Business 001 loaded in local durable state: ${path}`);
console.log(`Workforce: ${loaded.agents.map(a => a.record.name).join(", ")}`);
console.log(`Service: ${loaded.manifest.identity.purpose}; jobs are created only from operator input.`);
console.log("No model/network call, customer, payment or revenue created. Local state is excluded from Git.");
