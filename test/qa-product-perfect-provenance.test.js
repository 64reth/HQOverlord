/* node test/qa-product-perfect-provenance.test.js
 * W0 build-provenance taxonomy. The official label is an externally earned
 * classification; a build or JSON receipt cannot self-assert it.
 */
'use strict';
const A = require('./_assert.js');

(async () => {
  const {
    KINDS,
    classifyProvenance,
    externallyVerifyOfficialEvidence,
  } = await import('../scripts/qa/product-perfect/provenance.mjs');

  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const artifact = { sha256: 'c'.repeat(64), size: 4242 };
  const evidence = {
    schemaVersion: 1,
    candidateCommit: commit,
    sourceTree: tree,
    artifact,
  };

  const clean = { commitSha: commit, sourceTree: tree, dirty: false, declaredKind: '', artifact };
  A.eq(classifyProvenance(clean).kind, KINDS.REPRODUCIBLE_SOURCE,
    'clean known commit+tree defaults to reproducible-source');
  A.eq(classifyProvenance(Object.assign({}, clean, { declaredKind: KINDS.CUSTOM })).kind, KINDS.CUSTOM,
    'an explicit custom build stays custom');
  A.eq(classifyProvenance(Object.assign({}, clean, { dirty: true })).kind, KINDS.DIRTY_DEV,
    'dirty bytes are always dirty-dev');
  A.eq(classifyProvenance(Object.assign({}, clean, { commitSha: 'unknown' })).kind, KINDS.DIRTY_DEV,
    'unknown commit is dirty-dev');
  A.eq(classifyProvenance(Object.assign({}, clean, { sourceTree: '' })).kind, KINDS.DIRTY_DEV,
    'unknown source tree is dirty-dev');

  // A plain object that says it was verified is still hand-authored data, not authority.
  const handAsserted = Object.assign({}, evidence, { verified: true, authority: 'owner' });
  A.eq(classifyProvenance(Object.assign({}, clean, { verifiedOfficialEvidence: handAsserted })).kind,
    KINDS.REPRODUCIBLE_SOURCE, 'hand-asserted evidence never promotes a build to official');

  const noVerifier = externallyVerifyOfficialEvidence(evidence);
  A.eq(noVerifier.ok, false, 'official evidence requires an external verifier');

  const rejected = externallyVerifyOfficialEvidence(evidence, () => ({ ok: false, error: 'signature rejected' }));
  A.eq(rejected.ok, false, 'a rejecting verifier cannot mint official authority');

  const verified = externallyVerifyOfficialEvidence(evidence, () => ({
    ok: true,
    authority: 'release-attestation-verifier',
    verificationId: 'attestation-123',
  }));
  A.eq(verified.ok, true, 'an external verifier can mint bounded official authority');
  A.eq(classifyProvenance(Object.assign({}, clean, { verifiedOfficialEvidence: verified.capability })).kind,
    KINDS.OFFICIAL, 'verified exact commit/tree/artifact evidence earns official');

  const wrongArtifact = Object.assign({}, clean, { artifact: { sha256: 'd'.repeat(64), size: 4242 }, verifiedOfficialEvidence: verified.capability });
  A.eq(classifyProvenance(wrongArtifact).kind, KINDS.REPRODUCIBLE_SOURCE,
    'official evidence for different artifact bytes is rejected');
  A.eq(classifyProvenance(Object.assign({}, clean, { sourceTree: 'd'.repeat(40), verifiedOfficialEvidence: verified.capability })).kind,
    KINDS.REPRODUCIBLE_SOURCE, 'official evidence for a different source tree is rejected');
  A.eq(classifyProvenance(Object.assign({}, clean, { declaredKind: KINDS.CUSTOM, verifiedOfficialEvidence: verified.capability })).kind,
    KINDS.CUSTOM, 'external evidence cannot relabel an explicit custom build');

  A.report('qa-product-perfect-provenance.test');
})().catch((error) => { console.error(error); process.exit(1); });
