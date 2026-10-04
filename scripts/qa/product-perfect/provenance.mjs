/* W0 build-provenance taxonomy.
 *
 * This module deliberately has no filesystem, Git, process, or network authority. It
 * classifies facts supplied by the build/installed-proof seams. In particular, JSON cannot
 * self-assert `official`: that label requires a capability minted during this process by an
 * independently supplied verifier, and the capability is bound to one commit, tree, and
 * artifact identity. Open-source/source-built artifacts remain first-class and truthful.
 */

export const KINDS = Object.freeze({
  OFFICIAL: 'official',
  REPRODUCIBLE_SOURCE: 'reproducible-source',
  CUSTOM: 'custom',
  DIRTY_DEV: 'dirty-dev',
});

export const OFFICIAL_EVIDENCE_SCHEMA = 1;

const VERIFIED_OFFICIAL = Symbol('starnet.verifiedOfficialEvidence');
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function str(value) { return value == null ? '' : String(value); }
function sha40(value) {
  const normalized = str(value).trim().toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}
function artifactIdentity(value) {
  const sha256 = str(value && value.sha256).trim().toLowerCase();
  const size = Number(value && value.size);
  if (!SHA256.test(sha256) || !Number.isSafeInteger(size) || size <= 0) return null;
  return Object.freeze({ sha256, size });
}

export function normalizeOfficialEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidateCommit = sha40(value.candidateCommit);
  const sourceTree = sha40(value.sourceTree);
  const artifact = artifactIdentity(value.artifact);
  if (value.schemaVersion !== OFFICIAL_EVIDENCE_SCHEMA || !candidateCommit || !sourceTree || !artifact) return null;
  return Object.freeze({
    schemaVersion: OFFICIAL_EVIDENCE_SCHEMA,
    candidateCommit,
    sourceTree,
    artifact,
  });
}

/* Ask a caller-supplied external verifier to authenticate official evidence. The verifier
 * may consult a signed release attestation, CI identity, or another release authority, but it
 * must return a stable authority + verification id. A boolean or a JSON `verified:true` field
 * is intentionally insufficient. This function is synchronous so READY's read-only inspector
 * can be called from any host without top-level async/process mutation.
 */
export function externallyVerifyOfficialEvidence(evidence, verifier) {
  const normalized = normalizeOfficialEvidence(evidence);
  if (!normalized) return { ok: false, error: 'official evidence is missing or malformed', capability: null };
  if (typeof verifier !== 'function') return { ok: false, error: 'no external official-evidence verifier supplied', capability: null };
  let verdict;
  try { verdict = verifier(normalized, evidence); }
  catch (error) { return { ok: false, error: 'official evidence verifier threw: ' + str(error && error.message || error), capability: null }; }
  if (!verdict || typeof verdict !== 'object' || verdict.ok !== true) {
    return { ok: false, error: str(verdict && verdict.error || 'external verifier rejected official evidence'), capability: null };
  }
  const authority = str(verdict.authority).trim();
  const verificationId = str(verdict.verificationId).trim();
  if (!authority || !verificationId) {
    return { ok: false, error: 'external verifier omitted authority or verification id', capability: null };
  }
  const capability = Object.freeze({
    [VERIFIED_OFFICIAL]: true,
    evidence: normalized,
    authority,
    verificationId,
  });
  return { ok: true, error: '', capability };
}

function officialSummary(capability) {
  if (!capability || capability[VERIFIED_OFFICIAL] !== true) return null;
  return Object.freeze({
    schemaVersion: capability.evidence.schemaVersion,
    candidateCommit: capability.evidence.candidateCommit,
    sourceTree: capability.evidence.sourceTree,
    artifact: capability.evidence.artifact,
    authority: capability.authority,
    verificationId: capability.verificationId,
  });
}

function sameArtifact(left, right) {
  const a = artifactIdentity(left);
  const b = artifactIdentity(right);
  return !!a && !!b && a.sha256 === b.sha256 && a.size === b.size;
}

export function classifyProvenance(input) {
  input = input || {};
  const commitSha = sha40(input.commitSha);
  const sourceTree = sha40(input.sourceTree);
  const declared = str(input.declaredKind).trim().toLowerCase();
  const reasons = [];

  // Unknown identity is treated exactly like dirt. It may be useful for development, but it
  // cannot become candidate-bound evidence under a softer name.
  if (input.dirty === true || !commitSha || !sourceTree || declared === KINDS.DIRTY_DEV) {
    if (input.dirty === true) reasons.push('shipped source is dirty');
    if (!commitSha) reasons.push('full source commit is unknown');
    if (!sourceTree) reasons.push('source tree is unknown');
    if (declared === KINDS.DIRTY_DEV) reasons.push('build declared dirty-dev');
    return { kind: KINDS.DIRTY_DEV, commitSha, sourceTree, officialEvidence: null, reasons };
  }

  // Only the build-time `custom` declaration is privileged. A self-declared `official`
  // artifact is still custom until an external verifier proves otherwise, and arbitrary
  // non-empty declarations are conservatively custom rather than source-reproducible.
  const explicitCustom = declared === KINDS.CUSTOM ||
    (declared !== '' && declared !== KINDS.REPRODUCIBLE_SOURCE);
  if (explicitCustom) {
    reasons.push(declared === KINDS.CUSTOM ? 'build explicitly declared custom' : 'unsupported build declaration treated as custom');
    return { kind: KINDS.CUSTOM, commitSha, sourceTree, officialEvidence: null, reasons };
  }

  const capability = input.verifiedOfficialEvidence;
  const summary = officialSummary(capability);
  if (summary) {
    const exact = summary.candidateCommit === commitSha &&
      summary.sourceTree === sourceTree && sameArtifact(summary.artifact, input.artifact);
    if (exact) return { kind: KINDS.OFFICIAL, commitSha, sourceTree, officialEvidence: summary, reasons };
    reasons.push('verified official evidence does not match commit, tree, and artifact');
  } else if (input.verifiedOfficialEvidence) {
    reasons.push('hand-authored official evidence has no verifier capability');
  }

  return { kind: KINDS.REPRODUCIBLE_SOURCE, commitSha, sourceTree, officialEvidence: null, reasons };
}
