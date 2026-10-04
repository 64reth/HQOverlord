/* sidecar/harness-snapshot.js — bounded, secret-free harness self-knowledge.

   The sidecar already knows its build, scheduler, connector and diagnostics state, but those
   truths historically ended at token-gated UI routes. This pure composer turns already-collected
   values into ONE agent-safe snapshot. Every section is independently confirmed/unavailable:
   a failed reader must never become a confident zero, empty list, or healthy status.

   No IO, no ambient clock, no secrets. Callers inject `now` and `redact`; only an allowlisted
   subset of every source object crosses this boundary. */
'use strict';

const MAX_CONNECTORS = 30;
const MAX_ERRORS = 5;
const MAX_SWALLOWED = 12;   // fail-open tag rows an agent sees — the loudest seams; bounded like every other section

function oneLine(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 160);
}

function unavailable(reason) {
  return { status: 'unavailable', reason: oneLine(reason || 'source could not be read', 180) };
}

function confirmed(data) {
  return { status: 'confirmed', data: data };
}

function safeRead(reader, shape) {
  if (typeof reader !== 'function') return unavailable('source is not wired');
  try { return confirmed(shape(reader())); }
  catch (e) { return unavailable((e && e.message) || e || 'source could not be read'); }
}

function buildShape(raw) {
  raw = raw || {};
  return {
    harness: oneLine(raw.harness, 80) || 'unknown',
    app: oneLine(raw.app, 40) || 'unknown',
    node: oneLine(raw.node, 40) || 'unknown',
    source: oneLine(raw.harnessSource, 24) || 'unknown',
    buildSha: /^[0-9a-f]{40}$/i.test(String(raw.buildSha || '')) ? String(raw.buildSha).toLowerCase() : '',
    dirty: raw.buildDirty === true ? true : raw.buildDirty === false ? false : null
  };
}

function runtimeShape(raw) {
  raw = raw || {};
  return {
    provider: oneLine(raw.provider, 80) || 'unknown',
    requestedModel: oneLine(raw.model, 160) || 'unknown',
    agentId: oneLine(raw.agentId, 80) || 'agent',
    runId: oneLine(raw.runId, 120) || 'unknown',
    surface: oneLine(raw.surface, 40) || 'interactive',
    trigger: oneLine(raw.trigger, 40) || 'directive'
  };
}

function schedulerShape(raw) {
  raw = raw || {};
  const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
  const health = raw.health && typeof raw.health === 'object' ? raw.health : {};
  return {
    armed: raw.enabled === true,
    halted: raw.halted === true,
    healthy: health.healthy === true,
    jobCount: jobs.length,
    tickMs: Number.isFinite(Number(raw.tickMs)) ? Number(raw.tickMs) : null,
    lastTickAt: Number.isFinite(Number(health.lastTickAt)) ? Number(health.lastTickAt) : null,
    lastSuccessAt: Number.isFinite(Number(health.lastSuccessAt)) ? Number(health.lastSuccessAt) : null,
    lastError: oneLine(health.lastTickError, 240) || null
  };
}

function connectorShape(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const live = rows.filter(row => row && row.enabled !== false && row.state === 'up');
  const connected = live.slice(0, MAX_CONNECTORS).map(row => ({
    id: oneLine(row && row.id, 80) || 'unknown',
    name: oneLine(row && (row.label || row.name), 100) || oneLine(row && row.id, 80) || 'unknown',
    state: oneLine(row && row.state, 40) || 'unknown',
    enabled: !(row && row.enabled === false),
    toolCount: Number.isFinite(Number(row && row.toolCount)) ? Number(row.toolCount) : 0,
    oauth: !!(row && row.oauth)
  }));
  return { count: live.length, configuredCount: rows.length, connected: connected, truncated: live.length > connected.length };
}

function diagnosticsShape(raw, redact) {
  raw = raw || {};
  const clean = value => oneLine(redact(String(value == null ? '' : value)), 300);
  const errors = (Array.isArray(raw.errors) ? raw.errors : []).slice(-MAX_ERRORS).map(row => ({
    ts: Number.isFinite(Number(row && row.ts)) ? Number(row.ts) : null,
    message: clean(row && row.message)
  })).filter(row => row.message);
  return {
    errorCount: Array.isArray(raw.errors) ? raw.errors.length : errors.length,
    recentErrors: errors,
    lastRun: raw.lastRun && typeof raw.lastRun === 'object' ? {
      runId: oneLine(raw.lastRun.runId, 100) || 'unknown',
      status: oneLine(raw.lastRun.status, 40) || 'unknown',
      ts: Number.isFinite(Number(raw.lastRun.ts)) ? Number(raw.lastRun.ts) : null
    } : null,
    uptimeMs: Number.isFinite(Number(raw.uptimeMs)) ? Number(raw.uptimeMs) : null,
    workspacePresent: raw.workspacePresent === true,
    agentCount: Number.isFinite(Number(raw.agentCount)) ? Number(raw.agentCount) : null,
    // swallowed-error pressure (failopen.summary()). Tags are code literals, redacted anyway; counts + epoch ms
    // only. null when the caller could not read the tally — an agent must not read a missing tally as zero.
    swallowed: swallowedShape(raw.swallowed, redact)
  };
}

function swallowedShape(raw, redact) {
  if (!raw || typeof raw !== 'object') return null;
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).slice(0, MAX_SWALLOWED).map(row => ({
    tag: oneLine(redact(String(row && row.tag == null ? '' : row.tag)), 80) || 'untagged',
    count: Number.isFinite(Number(row && row.count)) ? Number(row.count) : 0,
    lastAt: Number.isFinite(Number(row && row.lastAt)) ? Number(row.lastAt) : null
  })).filter(row => row.count > 0);
  const total = Number.isFinite(Number(raw.total)) ? Number(raw.total) : 0;
  const tagCount = Number.isFinite(Number(raw.tagCount)) ? Number(raw.tagCount) : tags.length;
  return { total, tagCount, truncated: raw.truncated === true || tagCount > tags.length, tags };
}

function makeHarnessSnapshot(deps) {
  deps = deps || {};
  const now = typeof deps.now === 'function' ? deps.now : (() => 0);
  const redact = typeof deps.redact === 'function' ? deps.redact : (value => value);

  function snapshot(runtime) {
    return {
      schemaVersion: 1,
      observedAt: Number(now()) || 0,
      build: safeRead(deps.readBuild, buildShape),
      runtime: confirmed(runtimeShape(runtime)),
      scheduler: safeRead(deps.readScheduler, schedulerShape),
      connectors: safeRead(deps.readConnectors, connectorShape),
      diagnostics: safeRead(deps.readDiagnostics, raw => diagnosticsShape(raw, redact))
    };
  }

  return { snapshot };
}

module.exports = {
  makeHarnessSnapshot,
  oneLine,
  unavailable,
  confirmed,
  _internals: { buildShape, runtimeShape, schedulerShape, connectorShape, diagnosticsShape, swallowedShape, safeRead, MAX_CONNECTORS, MAX_ERRORS, MAX_SWALLOWED }
};
