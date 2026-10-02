import { createServer, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BusinessId } from "@hqoverlord/core";
import type { CommandContext, DurableRuntime } from "@hqoverlord/runtime";
import { projectBusiness, wireJson } from "./projection.ts";

export interface ControlCentreOptions {
  readonly runtime: DurableRuntime;
  /** Explicit host authorization, not inferred from request query parameters. */
  readonly businessIds: readonly BusinessId[];
  readonly context: (businessId: BusinessId) => CommandContext;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly modelEnabled?: boolean;
  readonly prepare?: (context: CommandContext, input: { id: string; url: string; material: string }) => Promise<unknown>;
  readonly run?: (context: CommandContext, jobId: string) => Promise<unknown>;
  readonly assetRoot?: URL;
}

export function createControlCentre(options: ControlCentreOptions) {
  const token = randomBytes(32).toString("hex");
  const clients = new Map<ServerResponse, BusinessId>();
  const epoch = randomBytes(8).toString("hex"); let sequence = 0;
  const assets = new Set(["index.html", "app.js", "client-state.js", "room.js", "style.css", "assets/agent.svg", "assets/workstation.svg"]);
  function project(businessId: BusinessId) {
    const snapshot = options.runtime.snapshot(), context = options.context(businessId);
    const active = new Set(snapshot.authority.jobs.filter(j => j.businessId === businessId && options.runtime.isJobActive(context, j.id)).map(j => j.id));
    return { ...projectBusiness(snapshot, businessId, active), businesses: snapshot.authority.businesses.filter(b => options.businessIds.includes(b.id)),
      metadata: options.metadata?.[businessId] ?? null, modelEnabled: !!options.modelEnabled };
  }
  function send(res: ServerResponse, businessId: BusinessId) {
    try {
      const ok = res.write(`id: ${epoch}:${sequence}\nevent: snapshot\ndata: ${wireJson(project(businessId))}\n\n`);
      if (!ok && res.writableLength > 1024 * 1024) { clients.delete(res); res.destroy(); }
    } catch { clients.delete(res); res.destroy(); }
  }
  const unsubscribe = options.runtime.subscribe(() => { sequence++; for (const [res, id] of clients) send(res, id); });
  const heartbeat = setInterval(() => { for (const [res] of clients) {
    try { const ok = res.write("event: heartbeat\ndata: {}\n\n"); if (!ok && res.writableLength > 1024 * 1024) { clients.delete(res); res.destroy(); } }
    catch { clients.delete(res); res.destroy(); }
  } }, 10_000); heartbeat.unref();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const host = req.headers.host ?? "";
    if (!/^127\.0\.0\.1:\d+$/.test(host)) { res.writeHead(403).end("Invalid host"); return; }
    if (req.headers.origin && req.headers.origin !== `http://${host}` || req.headers["sec-fetch-site"] === "cross-site") { res.writeHead(403).end("Invalid origin"); return; }
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET") { res.writeHead(405).end(); return; }
        const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (!assets.has(asset)) { res.writeHead(404).end(); return; }
        const root = options.assetRoot ?? new URL("../dist/", import.meta.url);
        const content = await readFile(new URL(asset, root));
        // HttpOnly local session; master token is never placed in URLs, logs or JS.
        if (asset === "index.html") res.setHeader("Set-Cookie", `hq_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
        res.setHeader("Content-Type", asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8");
        res.end(content); return;
      }
      const supplied = /(?:^|;\s*)hq_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
      if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { res.writeHead(401).end("Unauthorized"); return; }
      const businessId = options.businessIds.find(id => id === url.searchParams.get("business")) ?? (!url.searchParams.has("business") ? options.businessIds[0] : undefined);
      if (!businessId) { res.writeHead(403).end("Business unavailable"); return; }
      if (req.method === "GET" && url.pathname === "/api/snapshot") { res.setHeader("Content-Type", "application/json"); res.end(wireJson(project(businessId))); return; }
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        clients.set(res, businessId); send(res, businessId); // Full hydration on every reconnect/restart: no delta gaps.
        req.on("close", () => clients.delete(res)); return;
      }
      if (req.method !== "POST" || req.headers["content-type"] !== "application/json" || req.headers.origin !== `http://${host}`) { res.writeHead(403).end("Invalid mutation"); return; }
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; if (size > 64_000) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const context = options.context(businessId); let result: unknown;
      if (url.pathname === "/api/cancel" && typeof input.jobId === "string") result = await options.runtime.cancelJob(context, options.runtime.snapshot().authority.jobs.find(j => j.id === input.jobId && j.businessId === businessId)?.id ?? (() => { throw new Error("Job unavailable"); })());
      else if (url.pathname === "/api/approval" && typeof input.approvalId === "string" && ["approve", "reject"].includes(String(input.decision))) {
        const approval = options.runtime.snapshot().approvals?.find(a => a.id === input.approvalId && a.businessId === businessId);
        if (!approval) throw new Error("Approval unavailable");
        result = input.decision === "approve" ? await options.runtime.approveOperation(context, approval.id) : await options.runtime.rejectOperation(context, approval.id, "Rejected by local operator");
      } else if (url.pathname === "/api/prepare" && options.prepare && typeof input.id === "string" && typeof input.url === "string" && typeof input.material === "string") result = await options.prepare(context, { id: input.id, url: input.url, material: input.material });
      else if (url.pathname === "/api/run" && options.run && typeof input.jobId === "string") {
        const job = options.runtime.snapshot().authority.jobs.find(j => j.id === input.jobId && j.businessId === businessId);
        if (!job) throw new Error("Job unavailable");
        options.runtime.jobInputs(context, job.id);
        const agent = options.runtime.snapshot().authority.agents.find(a => a.id === job.agentId && a.businessId === businessId);
        if (!options.modelEnabled && !agent?.toolIds.includes("artifact.release" as import("@hqoverlord/core").ToolId)) throw new Error("Paid execution disabled");
        // Respond immediately; durable SSE carries progress/outcome. Do not retry jobs on reconnect.
        void options.run(context, job.id).catch(() => { sequence++; for (const [client, id] of clients) send(client, id); });
        result = { accepted: true };
      } else { res.writeHead(404).end(); return; }
      res.setHeader("Content-Type", "application/json"); res.end(wireJson(result));
    } catch { if (!res.headersSent) res.writeHead(409, { "Content-Type": "application/json" }).end(wireJson({ error: "Operation refused or unavailable; inspect authoritative job/approval state" })); else res.destroy(); }
  });
  server.on("close", () => { unsubscribe(); clearInterval(heartbeat); });
  return { server, close: async () => { for (const [res] of clients) res.end(); clients.clear(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
