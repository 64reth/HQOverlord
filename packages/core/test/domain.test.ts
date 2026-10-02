import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { currencyCode, ids, money } from "../src/index.ts";
import type { Agent, Approval, Business, Job, LedgerEntry, Tool, Workflow } from "../src/index.ts";

const businessId = ids.business("business-1");
const jobId = ids.job("job-1");

test("domain records describe business isolation and generic capabilities", () => {
  const business: Business = {
    id: businessId, name: "Example", status: "active",
    createdAt: "2026-10-02T12:00:00.000Z", updatedAt: "2026-10-02T12:00:00.000Z",
  };
  const tool: Tool = {
    id: ids.tool("tool-1"), name: "Read local file", description: "Reads an allowed file", effect: "read_only",
  };
  const agent: Agent = {
    id: ids.agent("agent-1"), businessId, name: "Worker", status: "idle",
    capabilities: ["read_documents"], toolIds: [tool.id],
  };
  const workflow: Workflow = {
    id: ids.workflow("workflow-1"), businessId, name: "Review", description: "Review a document", status: "draft",
  };
  const job: Job = {
    id: jobId, businessId, agentId: agent.id, workflowId: workflow.id,
    objective: "Review the supplied document", status: "queued",
  };
  const unassignedJob: Job = { id: ids.job("job-2"), businessId, objective: "Await assignment", status: "queued" };
  const approval: Approval = {
    id: ids.approval("approval-1"), businessId, operationId: ids.operation("operation-1"),
    jobId, reason: "Operation requires host approval", status: "pending",
  };
  for (const record of [agent, workflow, job, unassignedJob, approval]) {
    assert.equal(record.businessId, business.id);
  }
  assert.deepEqual(agent.toolIds, [tool.id]);
  assert.equal(unassignedJob.agentId, undefined);
  assert.equal(approval.status, "pending");
});

test("ledger money uses exact bigint minor units with explicit currency and direction", () => {
  const amount = money(900719925474099312345n, currencyCode("GBP"));
  const entry: LedgerEntry = {
    id: ids.ledgerEntry("entry-1"), businessId, jobId, kind: "revenue", amount,
    description: "Payment received", occurredAt: "2026-10-02T12:00:00.000Z",
  };
  const expense: LedgerEntry = { ...entry, id: ids.ledgerEntry("entry-2"), kind: "expense", amount: money(1234n, currencyCode("GBP")) };
  assert.equal(typeof entry.amount.minorUnits, "bigint");
  assert.equal(entry.amount.minorUnits + 1n, 900719925474099312346n);
  assert.equal(entry.amount.currency, "GBP");
  assert.equal(expense.amount.minorUnits, 1234n);
  assert.equal(expense.kind, "expense");
  assert.throws(() => money(-1n, currencyCode("GBP")), TypeError);
  assert.throws(() => currencyCode("gbp"), TypeError);
  assert.throws(() => currencyCode(""), TypeError);
});

test("identifier factories reject empty identifiers", () => {
  for (const factory of Object.values(ids)) assert.throws(() => factory("  "), TypeError);
});

test("core has no frontend or integration package dependency", async () => {
  const sourceDirectory = new URL("../src/", import.meta.url);
  for (const file of await readdir(sourceDirectory)) {
    const source = await readFile(new URL(file, sourceDirectory), "utf8");
    const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)];
    for (const match of imports) assert.ok(match[1]?.startsWith("./"), `${file} imports ${match[1]}`);
  }
  const manifest: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null);
  assert.ok(!("dependencies" in manifest));
});
