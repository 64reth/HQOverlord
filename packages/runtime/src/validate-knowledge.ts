import type { DurableState } from "./durable-state.ts";
import { RuntimeError } from "./runtime-error.ts";

export function validateKnowledge(state: DurableState): void {
  const fail = (): never => { throw new RuntimeError("INVALID_STATE", "Invalid scoped knowledge/handoff state"); };
  const artifacts = state.artifacts ?? [], sources = state.sources ?? [], knowledge = state.knowledge ?? [];
  for (const list of [artifacts, sources, knowledge]) {
    if (!Array.isArray(list)) fail();
    const ids = new Set<string>();
    for (const record of list) {
      if (!record.id?.trim() || ids.has(record.id) || !state.authority.businesses.some(b => b.id === record.businessId)
        || !Number.isFinite(Date.parse(record.createdAt)) || !record.correlationId || record.producer !== "hq.runtime"
        || !record.actor?.id || !["human", "system", "agent"].includes(record.actor.kind)) fail();
      ids.add(record.id);
      if (record.jobId && !state.authority.jobs.some(j => j.id === record.jobId && j.businessId === record.businessId)) fail();
      if (record.agentId && !state.authority.agents.some(a => a.id === record.agentId && a.businessId === record.businessId)) fail();
      if (record.agentId && record.jobId && !state.authority.jobs.some(j => j.id === record.jobId && j.agentId === record.agentId)) fail();
    }
  }
  for (const source of sources) if (typeof source.uri !== "string" || typeof source.content !== "string" || !source.contentType || !Number.isFinite(Date.parse(source.retrievedAt))) fail();
  for (const artifact of artifacts) {
    if (!["text", "structured", "source", "analysis", "draft", "report"].includes(artifact.category) || !artifact.contentType || !Array.isArray(artifact.sourceIds) || !Array.isArray(artifact.references)) fail();
    for (const id of artifact.sourceIds) if (!sources.some(s => s.id === id && s.businessId === artifact.businessId)) fail();
    // Persisted content is JSON data plus bigint, never executable/prototype-bearing objects.
    const visit = (value: unknown, seen = new Set<object>()): void => {
      if (value === null || ["string", "boolean", "bigint"].includes(typeof value)) return;
      if (typeof value === "number" && Number.isFinite(value)) return;
      if (typeof value !== "object" || !value || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) fail();
      seen.add(value as object);
      if (!Array.isArray(value) && Object.keys(value as object).length === 1 && Object.hasOwn(value as object, "$hq.bigint")) fail();
      for (const child of Object.values(value as object)) visit(child, seen);
      seen.delete(value as object);
    };
    visit(artifact.content);
  }
  for (const record of [...artifacts, ...knowledge]) {
    if (!Array.isArray(record.references)) fail();
    for (const ref of record.references) if (ref.businessId !== record.businessId || !artifacts.some(a => a.id === ref.artifactId && a.businessId === record.businessId)) fail();
  }
  for (const fact of knowledge) if (!fact.statement?.trim() || fact.verification !== "unverified" || !fact.references.length) fail();
  for (const job of state.authority.jobs) {
    if (job.dependsOn && (!Array.isArray(job.dependsOn) || new Set(job.dependsOn).size !== job.dependsOn.length)) fail();
    for (const id of job.dependsOn ?? []) if (id === job.id || !state.authority.jobs.some(j => j.id === id && j.businessId === job.businessId)) fail();
    for (const id of job.inputArtifactIds ?? []) if (!artifacts.some(a => a.id === id && a.businessId === job.businessId)) fail();
    const walk = (id: string, path: Set<string>): void => {
      if (path.has(id)) fail();
      const next = new Set(path); next.add(id);
      for (const dependency of state.authority.jobs.find(j => j.id === id)?.dependsOn ?? []) walk(dependency, next);
    };
    walk(job.id, new Set());
  }
}
