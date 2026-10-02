import { ids, type Job } from "@hqoverlord/core";
import { correlationId } from "@hqoverlord/events";
import { commandId, commandFingerprint, createWebReadTool, ToolRegistry, type CommandContext, type DurableRuntime,
  type ModelProvider, type WebReadDependencies, type AgentDriver, type ModelExecutionOptions } from "@hqoverlord/runtime";
import { businessId, workflow, jobModelOptions } from "./manifest.ts";
import type { loadBusiness001 } from "./load.ts";

export const releaseToolId = ids.tool("artifact.release");
export function ownerContext(label: string): CommandContext {
  return { commandId: commandId(label), businessId, principal: { kind: "human", id: "local-owner" }, correlationId: correlationId("business-001-first-customer") };
}

/** Bootstrap v1 stays replayable. New capabilities are explicit backend permission configuration. */
export async function enableMission(loaded: Awaited<ReturnType<typeof loadBusiness001>>) {
  for (const worker of loaded.agents) await loaded.runtime.configureAgentTools(ownerContext(`configure-${worker.role}`), worker.record.id,
    worker.role === "prospect-research" ? [ids.tool("web.read")] : worker.role === "delivery" ? [releaseToolId] : []);
  // The v1 placeholder is superseded by a source-backed attempt, not silently redefined.
  if (loaded.runtime.inspectJob(ownerContext("legacy-read"), loaded.firstJob.id).status === "queued")
    await loaded.runtime.cancelJob(ownerContext("supersede-v1-placeholder"), loaded.firstJob.id);
}

/** Human-supplied material starts a distinct durable mission attempt; no fabricated prospect/customer. */
export async function prepareMission(loaded: Awaited<ReturnType<typeof loadBusiness001>>, input: { id: string; url: string; material: string }) {
  if (!input.id.trim() || !input.material.trim()) throw new TypeError("Mission requires supplied source material and a stable attempt identifier");
  await enableMission(loaded);
  const runtime = loaded.runtime, context = ownerContext(`mission-${input.id}`);
  const prior = runtime.snapshot().sources?.find(s => s.id === `supplied:${input.id}`);
  const source = await runtime.recordSource(context, { id: `supplied:${input.id}`, uri: input.url || "human:provided", content: input.material,
    contentType: "text/plain", retrievedAt: prior?.retrievedAt ?? new Date().toISOString() });
  const artifact = await runtime.createArtifact(context, { id: `source:${input.id}`, category: "source", contentType: "text/plain", content: input.material, sourceIds: [source.id] });
  const objectives = [
    `Research supplied prospect/source evidence. ${input.url ? `Public URL to read if useful: ${input.url}.` : "Only supplied material is available."} Produce a source-backed suitability assessment. No contact, deployment, payment or invented facts.`,
    "Organise research and source artifacts into reference knowledge. Label uncertainty and unsupported claims; do not claim verification from drafting alone.",
    "Draft assistant instructions and configuration from the supplied knowledge/source artifacts. No external deployment.",
    "Review assistant output against supplied knowledge and source artifacts. State supported answers, uncertainties, and whether suitable for human review. No invented validation.",
    "After the required human release approval, draft a delivery packet from QA and assistant artifacts. No customer contact or deployment. Human must confirm suitability and actual external payment separately.",
  ];
  const jobs: Job[] = [];
  for (let i = 0; i < loaded.agents.length; i++) {
    const previous = jobs[i - 1];
    const job = (await runtime.createJob(ownerContext(`mission-${input.id}-${i}`), { objective: objectives[i]!, agentId: loaded.agents[i]!.record.id,
      workflowId: workflow.id, inputArtifactIds: [artifact.id], dependsOn: previous ? jobs.map(j => j.id) : [] })).record;
    jobs.push(job);
  }
  return jobs;
}

export function missionTools(runtime: DurableRuntime, webDependencies: WebReadDependencies = {}): ToolRegistry {
  const tools = new ToolRegistry(), web = createWebReadTool(webDependencies);
  tools.register({ ...web, async execute(input, execution) {
    const result = await web.execute(input, execution);
    const output = result.output as { finalUrl: string; text: string; contentType: string; retrievedAt: string };
    const context: CommandContext = { ...ownerContext(`web-source-${execution.job.id}`), principal: { kind: "agent", id: execution.agent.id } };
    const id = `web:${execution.job.id}:${commandFingerprint(output)}`;
    const source = await runtime.recordSource(context, { id, uri: output.finalUrl, content: output.text, contentType: output.contentType, retrievedAt: output.retrievedAt, jobId: execution.job.id });
    const artifact = await runtime.createArtifact(context, { id: `source:${id}`, jobId: execution.job.id, category: "source", contentType: source.contentType,
      content: source.content, sourceIds: [source.id] });
    return { output: { ...(result.output as object), sourceId: source.id, artifactId: artifact.id } };
  } });
  tools.register({ definition: { id: releaseToolId, name: "artifact.release", description: "Human review before preparing a local delivery packet; does not contact or deploy", effect: "consequential" },
    inputSchema: { type: "object", properties: { artifactIds: { type: "array", items: { type: "string" } } }, required: ["artifactIds"], additionalProperties: false },
    async execute(input, execution) {
      const expected = runtime.jobInputs(ownerContext(`release-${execution.job.id}`), execution.job.id).map(a => a.id);
      const provided = (input as { artifactIds?: unknown })?.artifactIds;
      if (!Array.isArray(provided) || JSON.stringify(provided) !== JSON.stringify(expected)) throw new TypeError("Release must reference the exact reviewed artifacts");
      return { output: { artifactIds: expected, release: "human-approved-local-preparation-only" } };
    } });
  return tools;
}

/** Mandatory host-side Delivery gate, independent of whether a model asks for consent. */
export async function runMissionJob(runtime: DurableRuntime, jobId: ReturnType<typeof ids.job>, provider: ModelProvider, tools: ToolRegistry,
  options: ModelExecutionOptions = jobModelOptions()) {
  const context = ownerContext(`run-${jobId}`), job = runtime.inspectJob(context, jobId);
  const agent = runtime.snapshot().authority.agents.find(a => a.id === job.agentId)!;
  // Use runtime metering for each provider call through executeModelJob. A gating driver is used only for the initial local release.
  if (agent.toolIds.includes(releaseToolId)) {
      const gate: AgentDriver = { async next(turn) {
        if (!turn.observations.some(o => o.toolId === releaseToolId)) return { kind: "tool", toolId: releaseToolId,
          input: { artifactIds: (turn.inputs ?? []).map(a => a.id) } };
        // A granted exact operation unlocks only local preparation. Its durable result itself is the delivery handoff.
        return { kind: "complete", output: { kind: "delivery-packet", instructions: job.objective, artifacts: turn.inputs,
          release: "human-approved; external action remains manual" } };
      } };
      return runtime.executeJob(context, jobId, gate, tools);
  }
  const result = await runtime.executeModelJob(context, jobId, provider, tools, options);
  if (result.status === "completed" && agent.name === "Knowledge Builder") {
    await runtime.recordKnowledge(context, { id: `knowledge:${jobId}`, jobId, statement: "Job output contains source-backed reference knowledge; human validation still required",
      references: [{ businessId, artifactId: `job-output:${jobId}` }] });
  }
  return result;
}
