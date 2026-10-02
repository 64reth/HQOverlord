import { randomUUID } from "node:crypto";

import {
  ids,
  type AgentId,
  type JobId,
} from "@hqoverlord/core";

import {
  eventId,
  type EventId,
} from "@hqoverlord/events";

export interface RuntimeClock {
  now(): string;
}

export interface RuntimeIds {
  agent(): AgentId;
  job(): JobId;
  event(): EventId;
}

export const systemClock: RuntimeClock = {
  now: () => new Date().toISOString(),
};

export const systemIds: RuntimeIds = {
  agent: () => ids.agent(randomUUID()),
  job: () => ids.job(randomUUID()),
  event: () => eventId(randomUUID()),
};
