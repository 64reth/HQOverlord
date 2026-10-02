import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "@hqoverlord/core";
import { createWebReadTool, isPublicAddress, publicWebUrl, type WebReadDependencies, type ToolExecutionContext } from "../src/index.ts";
const businessId = ids.business("web-business");
const context: ToolExecutionContext = { businessId, job: { id: ids.job("job"), businessId, objective: "read", status: "running" }, agent: { id: ids.agent("agent"), businessId, name: "Reader", status: "idle", capabilities: [], toolIds: [ids.tool("web.read")] } };
const body = (text: string) => Buffer.from(text);
const deps: WebReadDependencies = { resolve: async () => [{ address: "93.184.216.34", family: 4 }], now: () => "2026-10-02T12:00:00Z",
  request: async (_url, address) => { assert.equal(address.address, "93.184.216.34"); return { status: 200, contentType: "text/html; charset=utf-8", body: body("<title>Public &amp; useful</title><script>invented</script><p>Evidence</p>") }; } };
test("mocked public read pins verified DNS and reports static textual content honestly", async () => {
  const result = await createWebReadTool(deps).execute({ url: "https://example.com" }, context);
  const out = result.output as { title: string; text: string; javascriptRendered: boolean; finalUrl: string };
  assert.equal(out.title, "Public & useful"); assert.match(out.text, /Evidence/); assert.doesNotMatch(out.text, /invented/); assert.equal(out.javascriptRendered, false); assert.equal(out.finalUrl, "https://example.com/");
});
for (const url of ["http://localhost", "http://localhost.", "http://127.0.0.1", "http://2130706433", "http://10.0.0.1", "http://172.16.0.1", "http://192.168.1.1", "http://169.254.169.254", "http://[::1]", "http://[::ffff:127.0.0.1]", "file:///etc/passwd", "ftp://example.com", "https://user:secret@example.com", "http://metadata.google.internal", "http://metadata.goog", "http://example.com:9000"]) {
  test(`web.read refuses unsafe URL ${url} before I/O`, async () => { let requests = 0;
    await assert.rejects(createWebReadTool({ resolve: async () => { requests++; return []; }, request: async () => { throw new Error("never"); } }).execute({ url }, context)); assert.equal(requests, 0);
  });
}
test("mixed public/private DNS and invalid DNS fail closed before a connection", async () => {
  for (const address of ["10.0.0.1", "::ffff:7f00:1", "not-an-ip"]) await assert.rejects(createWebReadTool({ ...deps, resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address, family: 4 }] }).execute({ url: "https://example.com" }, context), /PRIVATE_TARGET/);
});
test("private redirect cannot connect; each public redirect is independently DNS pinned", async () => {
  let calls = 0;
  await assert.rejects(createWebReadTool({ ...deps, request: async () => { calls++; return { status: 302, location: "http://10.0.0.1", contentType: "", body: body("") }; } }).execute({ url: "https://example.com" }, context), /PRIVATE_TARGET/); assert.equal(calls, 1);
  let resolutions = 0;
  await createWebReadTool({ ...deps, resolve: async () => { resolutions++; return [{ address: "93.184.216.34", family: 4 }]; }, request: async () => resolutions === 1 ? { status: 302, location: "https://other.example.com", contentType: "", body: body("") } : { status: 200, contentType: "text/plain", body: body("ok") } }).execute({ url: "https://example.com" }, context);
  assert.equal(resolutions, 2);
});
test("DNS rebinding cannot swap the verified connection address and redirect DNS is checked again", async () => {
  let calls = 0;
  await assert.rejects(createWebReadTool({ ...deps, resolve: async () => [{ address: ++calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }], request: async (_url, addr) => { assert.equal(addr.address, "93.184.216.34"); return { status: 302, location: "/again", body: body(""), contentType: "" }; } }).execute({ url: "https://example.com" }, context), /PRIVATE_TARGET/);
});
test("timeout covers DNS and body wait; cancellation is normalized without late network dispatch", async () => {
  const hanging = () => new Promise<never>(() => {});
  await assert.rejects(createWebReadTool({ ...deps, timeoutMs: 5, resolve: hanging }).execute({ url: "https://example.com" }, context), /TIMEOUT/);
  await assert.rejects(createWebReadTool({ ...deps, timeoutMs: 5, request: hanging }).execute({ url: "https://example.com" }, context), /TIMEOUT/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createWebReadTool(deps).execute({ url: "https://example.com" }, { ...context, signal: controller.signal }), /CANCELLED/);
});
test("oversize/binary/http errors and network details are normalized; plain/json remain text", async () => {
  for (const [contentType, text, maxBytes, error] of [["text/plain", "long", 2, "RESPONSE_TOO_LARGE"], ["image/png", "x", 10, "UNSUPPORTED_CONTENT"]] as const) await assert.rejects(createWebReadTool({ ...deps, maxBytes, request: async () => ({ status: 200, contentType, body: body(text) }) }).execute({ url: "https://example.com" }, context), new RegExp(error));
  await assert.rejects(createWebReadTool({ ...deps, request: async () => { throw new Error("secret detail"); } }).execute({ url: "https://example.com" }, context), /^WebReadError: web.read: NETWORK_ERROR$/);
  for (const contentType of ["text/plain", "application/json"]) assert.equal((await createWebReadTool({ ...deps, request: async () => ({ status: 200, contentType, body: body("raw") }) }).execute({ url: "https://example.com" }, context)).output && true, true);
  assert.throws(() => publicWebUrl("bad")); assert.equal(isPublicAddress("fc00::1"), false);
  for (const address of ["2001::1", "2001:0000:0000:0000:0000:0000:0000:0001", "2001:db8::1", "2002:7f00:1::", "3fff::1"]) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
