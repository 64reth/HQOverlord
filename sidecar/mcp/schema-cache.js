/* sidecar/mcp/schema-cache.js - deterministic MCP schema-cache identity and validation.
   The host owns durable I/O; this module owns the secret-safe, canonical fingerprint input and
   refuses malformed/oversized cache records before they can become model-visible tool schemas. */
'use strict';

const CACHE_VERSION = 1;
const MAX_ITEMS = 1000;
const MAX_BYTES = 2 * 1024 * 1024;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function fingerprintInput(cfg) {
  cfg = cfg || {};
  const env = {};
  for (const key of Object.keys(cfg.env || {}).sort()) env[key] = String(cfg.env[key] == null ? '' : cfg.env[key]);
  return {
    transport: String(cfg.transportKind || cfg.transport || 'stdio'),
    command: String(cfg.command || ''),
    args: Array.isArray(cfg.args) ? cfg.args.map(v => String(v == null ? '' : v)) : [],
    cwd: String(cfg.cwd || ''),
    env: env,
    agentId: String(cfg.agentId || ''),
    package: String(cfg.package || cfg.packageIdentity || '')
  };
}

function fingerprint(cfg, hash) {
  if (typeof hash !== 'function') throw new Error('mcp schema fingerprint requires an injected hash');
  return String(hash(JSON.stringify(stable(fingerprintInput(cfg)))) || '');
}

function copyArray(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  try {
    const cloned = JSON.parse(JSON.stringify(value));
    return JSON.stringify(cloned).length <= MAX_BYTES ? cloned : null;
  } catch (_) { return null; }
}

function normalize(raw) {
  if (!raw || raw.version !== CACHE_VERSION || typeof raw.fingerprint !== 'string' || !raw.fingerprint) return null;
  const tools = copyArray(raw.tools), resources = copyArray(raw.resources), prompts = copyArray(raw.prompts);
  if (!tools || !resources || !prompts) return null;
  if (tools.some(t => !t || typeof t.name !== 'string' || !t.name)) return null;
  return {
    version: CACHE_VERSION,
    fingerprint: raw.fingerprint,
    cachedAt: Number(raw.cachedAt) || 0,
    tools: tools,
    resources: resources,
    prompts: prompts
  };
}

function makeRecord(fingerprintValue, catalog, cachedAt) {
  return normalize({
    version: CACHE_VERSION,
    fingerprint: String(fingerprintValue || ''),
    cachedAt: Number(cachedAt) || 0,
    tools: (catalog && catalog.tools) || [],
    resources: (catalog && catalog.resources) || [],
    prompts: (catalog && catalog.prompts) || []
  });
}

module.exports = { CACHE_VERSION, fingerprint, normalize, makeRecord, _internals: { stable, fingerprintInput } };
