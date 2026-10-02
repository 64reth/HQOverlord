import { currencyCode, ids, money, type Workflow } from "@hqoverlord/core";
import type { MeteredPricing, ModelExecutionOptions } from "@hqoverlord/runtime";

export const businessId = ids.business("business-001");
const gbp = currencyCode("GBP");
export const workers = [
  { role: "prospect-research", name: "Prospect Research", purpose: "Analyse human-supplied prospects and public website material; identify suitable small businesses", capabilities: ["source-analysis", "prospect-research"] },
  { role: "knowledge-builder", name: "Knowledge Builder", purpose: "Organise supplied website material into source-backed assistant knowledge", capabilities: ["knowledge-organisation", "source-traceability"] },
  { role: "assistant-builder", name: "Assistant Builder", purpose: "Draft assistant configuration and instructions from approved knowledge", capabilities: ["configuration-drafting"] },
  { role: "qa", name: "QA", purpose: "Test drafted answers against source material and flag unsupported claims", capabilities: ["content-testing", "source-verification"] },
  { role: "delivery", name: "Delivery", purpose: "Draft delivery material and deployment handoff for human review", capabilities: ["delivery-drafting"] },
] as const;
export type WorkerRole = typeof workers[number]["role"];

export const workflow: Workflow = {
  id: ids.workflow("business-001-assistant-service"), businessId, name: "Website assistant preparation",
  description: "Source-backed research, knowledge, assistant drafting, QA and human-reviewed delivery preparation", status: "active",
};
export const manifest = {
  identity: { id: businessId, name: "Business 001", purpose: "Affordable AI website assistants for small businesses" },
  budgets: {
    internalAllocation: { amount: money(500n, gbp), kind: "internal-operating-allocation", status: "configuration-only-no-cross-currency-aggregate-enforcement" },
    fundingContext: { amount: money(2000n, gbp), source: "user-stated", providerTelemetry: false },
    perJobUsdLimit: money(5n, currencyCode("USD")),
    fxConversion: "none; GBP allocation is not a USD allowance or a provider account balance",
  },
  modelRouting: { defaultProvider: "openai", defaultModel: "gpt-6-luna", perJobOverride: true, agentIdentityContainsModel: false },
  authority: {
    autonomous: ["analyse supplied/public information", "organise knowledge", "draft configuration", "test content", "draft outreach/delivery material"],
    humanApprovalRequired: ["customer/prospect contact", "external publication", "customer deployment", "customer-facing price change", "purchases", "external spend beyond an admitted model budget"],
    externalToolsAvailable: true,
    publicReadTools: ["web.read"],
    externalConsequentialToolsAvailable: false,
    rule: "Public textual web reads are capability-gated. Contact, deployment and payment remain manual. Delivery preparation requires HQ's exact-operation human approval; it does not perform an external action.",
  },
  steps: [
    { id: "prospect", mode: "human-supplied-input", worker: "prospect-research", dependsOn: [] },
    { id: "research", mode: "model-draft", worker: "prospect-research", dependsOn: ["prospect"] },
    { id: "knowledge", mode: "model-draft", worker: "knowledge-builder", dependsOn: ["research"] },
    { id: "assistant", mode: "model-draft", worker: "assistant-builder", dependsOn: ["knowledge"] },
    { id: "qa", mode: "model-draft", worker: "qa", dependsOn: ["assistant"] },
    { id: "human-approval", mode: "manual-human-approval", dependsOn: ["qa"] },
    { id: "contact-delivery", mode: "manual-human-handoff", worker: "delivery", dependsOn: ["human-approval"] },
    { id: "payment-confirmation", mode: "manual-human-payment-evidence", dependsOn: ["contact-delivery"] },
    { id: "revenue-ledger", mode: "manual-human-ledger-handoff-not-implemented", dependsOn: ["payment-confirmation"] },
  ],
} as const;

/** Routing/pricing belongs to the job configuration, never to the generic Agent record. */
export function jobModelOptions(overrides: { readonly model?: string; readonly pricing?: MeteredPricing } = {}): ModelExecutionOptions {
  const model = overrides.model ?? manifest.modelRouting.defaultModel;
  if (model !== manifest.modelRouting.defaultModel && !overrides.pricing) throw new TypeError("Different models require explicit matching pricing");
  const pricing: MeteredPricing = overrides.pricing ?? { version: 1, currency: "USD", unit: "nanodollar", provider: "openai", model,
    tokensPerBlock: 1_000_000n, inputNanodollars: 100_000_000n, outputNanodollars: 500_000_000n, cachedInputNanodollars: 100_000_000n };
  if (pricing.model !== model) throw new TypeError("Model routing and pricing must match");
  return { model, maxInputTokens: 4096, maxOutputTokens: 1024, maxTurns: 8, budget: manifest.budgets.perJobUsdLimit, meteredPricing: pricing };
}
