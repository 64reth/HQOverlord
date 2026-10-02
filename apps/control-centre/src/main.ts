import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ids } from "@hqoverlord/core";
import { FileDurableStore, OpenAIModelProvider, systemClock, systemIds } from "@hqoverlord/runtime";
import { loadBusiness001 } from "../../../businesses/business-001/load.ts";
import { manifest, businessId } from "../../../businesses/business-001/manifest.ts";
import { enableWorkforce, serviceTools, ownerContext, prepareWork, runServiceJob } from "../../../businesses/business-001/operations.ts";
import { createControlCentre } from "./server.ts";

const statePath = process.env.HQ_STATE_PATH ?? fileURLToPath(new URL("../../../businesses/business-001/.local/state.json", import.meta.url));
const loaded = await loadBusiness001(new FileDurableStore(statePath), systemClock, systemIds);
await enableWorkforce(loaded);
const enabled = process.env.HQ_ENABLE_MODEL_EXECUTION === "1";
const provider = enabled ? new OpenAIModelProvider({ apiKey: process.env.OPENAI_API_KEY ?? "" }) : undefined;
const tools = serviceTools(loaded.runtime);
const app = createControlCentre({ runtime: loaded.runtime, businessIds: [businessId], context: () => ownerContext(`ui-${randomUUID()}`),
  metadata: { [businessId]: manifest }, modelEnabled: enabled,
  prepare: (_context, input) => prepareWork(loaded, input),
  run: async (_context, id) => {
    const job = loaded.runtime.inspectJob(ownerContext("inspect"), ids.job(id));
    const agent = loaded.runtime.snapshot().authority.agents.find(a => a.id === job.agentId);
    if (!provider && !agent?.toolIds.includes(ids.tool("artifact.release"))) throw new Error("Model execution disabled; explicitly enable it before starting paid jobs");
    // Local release driver never invokes this provider. Missing model configuration stays disabled.
    return runServiceJob(loaded.runtime, job.id, provider ?? { name: "disabled", async invoke() { throw new Error("Disabled"); } }, tools);
  },
});
const port = Number(process.env.HQ_PORT ?? 8788);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid HQ_PORT");
app.server.listen(port, "127.0.0.1", () => console.log(`HQOverlord Control Centre http://127.0.0.1:${port} · model execution ${enabled ? "explicitly enabled" : "disabled"}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void app.close(); });
