import type { AgentId, BusinessId, JobId } from "@hqoverlord/core";
import type { EventActor, CorrelationId } from "@hqoverlord/events";

export interface RecordProvenance {
  readonly businessId: BusinessId;
  readonly jobId?: JobId;
  readonly agentId?: AgentId;
  readonly createdAt: string;
  readonly correlationId: CorrelationId;
  readonly actor: EventActor;
  readonly producer: "hq.runtime";
}
export interface Source extends RecordProvenance {
  readonly id: string;
  readonly uri: string;
  readonly contentType: string;
  readonly content: string;
  readonly retrievedAt: string;
}
export interface ArtifactReference { readonly businessId: BusinessId; readonly artifactId: string }
export interface Artifact extends RecordProvenance {
  readonly id: string;
  readonly category: "text" | "structured" | "source" | "analysis" | "draft" | "report";
  readonly contentType: string;
  readonly content: unknown;
  readonly sourceIds: readonly string[];
  readonly references: readonly ArtifactReference[];
}
/** Reference material, not a verified assertion or an authority/permission grant. */
export interface KnowledgeFact extends RecordProvenance {
  readonly id: string;
  readonly statement: string;
  readonly references: readonly ArtifactReference[];
  readonly verification: "unverified";
}
