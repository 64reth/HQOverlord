/* node test/recipes.sop.test.js — SOP RECIPES (frontend/app/recipes.js, 2026-08-21).
   Locks the procedure + typed-acceptance fields: normalization mirrors the sidecar contract (types whitelist,
   relative-path rule, bounds), malformed rows drop silently, the procedure and the stated acceptance ride the
   directive via fillTask, postconditionsFor() mints the EXACT contract shape task-postconditions.js accepts (proved
   by running it through the sidecar normalizer), tokens fill in paths/text/commands, and the fields survive
   save / fork / export / import. Runs under node, in-memory custom store. */
'use strict';
const A = require('./_assert.js');
const R = require('../frontend/app/recipes.js');
const { normalizeContract } = require('../sidecar/task-postconditions.js');

// ---- a recipe with no SOP fields is byte-identical to before ----
{
  const plain = R.saveCustom(R.draft({ name: 'Plain', task: 'Brief me on {topic}' }));
  A.eq(plain.steps, [], 'no steps by default');
  A.eq(plain.acceptance, [], 'no acceptance by default');
  A.eq(R.fillTask(plain, { topic: 'x' }), 'Brief me on x', 'no SOP -> the directive is untouched');
  A.eq(R.postconditionsFor(plain, { topic: 'x' }), null, 'no acceptance -> no contract');
}

// ---- normalization ----
{
  const r = R.saveCustom(R.draft({
    name: 'Weekly invoice', task: 'Prepare the invoice for {client}', params: [{ key: 'client' }],
    steps: ['  pull   orders for {client} ', '', 'draft it', { text: 'save it' }, 42, 'x'.repeat(500)],
    acceptance: [
      { type: 'artifact_exists', path: 'out/{client}-invoice.md' },
      { type: 'artifact_contains', path: 'out/{client}-invoice.md', text: 'TOTAL' },
      { type: 'verification_passed', command: 'node scripts/check-invoice.js {client}' },
      { type: 'artifact_sha256', path: 'a.bin', sha256: 'F'.repeat(64) },
      { type: 'artifact_sha256', path: 'a.bin', sha256: '{digest}' },
      { type: 'artifact_exists', path: 'C:\\\\abs\\\\path.md' },       // absolute -> dropped
      { type: 'artifact_exists', path: '../escape.md' },               // `..` -> dropped
      { type: 'artifact_contains', path: 'ok.md' },                    // no text -> dropped
      { type: 'verification_passed' },                                  // no command -> dropped
      { type: 'browser_sees', path: 'x' },                              // unknown type -> dropped
      null, 'junk'
    ]
  }));
  A.eq(r.steps.length, 5, 'blank step dropped, object step coerced, non-string dropped (5 of 7 survive)');
  A.eq(r.steps[0], 'pull orders for {client}', 'whitespace collapsed');
  A.eq(r.steps[4].length, 240, 'a step is clipped to 240 chars');
  A.eq(r.acceptance.length, 5, 'exactly the 5 well-formed checks survive');
  A.eq(r.acceptance.map(a => a.type), ['artifact_exists', 'artifact_contains', 'verification_passed', 'artifact_sha256', 'artifact_sha256'], 'types in authored order');
  A.eq(r.acceptance[3].sha256, 'f'.repeat(64), 'sha256 lower-cased');
  A.ok(Object.isFrozen(r.acceptance) && Object.isFrozen(r.acceptance[0]), 'acceptance rows are frozen like params');

  // ---- the directive carries the procedure and STATES the acceptance ----
  const text = R.fillTask(r, { client: 'acme' });
  A.ok(/Procedure \(follow in this order; do not skip or reorder steps\):\n1\. pull orders for acme\n2\. draft it/.test(text), 'the procedure rides the directive, numbered, tokens filled');
  A.ok(/Acceptance \(the host checks these when you finish/.test(text), 'the acceptance block is stated');
  A.ok(text.indexOf('file exists: out/acme-invoice.md') >= 0, 'artifact check stated with the token filled');
  A.ok(text.indexOf('out/acme-invoice.md contains "TOTAL"') >= 0, 'contains check stated');
  A.ok(text.indexOf('check passes: node scripts/check-invoice.js acme') >= 0, 'command check stated with the token filled');

  // ---- the contract is EXACTLY what the sidecar accepts ----
  const pcs = R.postconditionsFor(r, { client: 'acme' });
  A.eq(pcs.schemaVersion, 'starnet.task-postconditions.v1', 'schema marker');
  A.eq(pcs.authority, 'commander', 'authority is the Commander (never the model)');
  A.eq(pcs.requirements.map(q => q.id), ['sop-1', 'sop-2', 'sop-3', 'sop-4', 'sop-5'], 'stable row ids');
  A.eq(pcs.requirements[0], { id: 'sop-1', type: 'artifact_exists', path: 'out/acme-invoice.md' }, 'exists row filled');
  A.eq(pcs.requirements[1], { id: 'sop-2', type: 'artifact_contains', path: 'out/acme-invoice.md', text: 'TOTAL' }, 'contains row');
  A.eq(pcs.requirements[2], { id: 'sop-3', type: 'verification_passed', command: 'node scripts/check-invoice.js acme' }, 'command row filled');
  // the sidecar's own normalizer is the authority — the first four rows must pass it unchanged
  const four = normalizeContract({ requirements: pcs.requirements.slice(0, 4) });
  A.eq(four.errors, [], 'the sidecar normalizer accepts the minted contract without error');
  A.eq(four.contract.requirements.length, 4, 'all four rows survive the sidecar');
  // an unfilled {digest} token is NOT a digest: the sidecar rejects that row (fail closed), which is the point of
  // keeping the sidecar the single authority — recipes.js never pretends to validate what it cannot fill.
  const five = normalizeContract(pcs);
  A.ok(five.contract === null && five.errors.some(e => /sha256/.test(e)), 'an unfilled sha256 token fails closed at the sidecar');
  const filled = normalizeContract(R.postconditionsFor(R.saveCustom(R.draft({ name: 'd', task: 'x {digest}', params: [{ key: 'digest' }], acceptance: [{ type: 'artifact_sha256', path: 'a.bin', sha256: '{digest}' }] })), { digest: 'A'.repeat(64) }));
  A.eq(filled.errors, [], 'a filled sha256 token passes the sidecar');

  // ---- fork / export / import carry the SOP ----
  const fork = R.forkFrom(r);
  A.eq(fork.steps.length, 5, 'fork carries steps');
  A.eq(fork.acceptance.length, 5, 'fork carries acceptance');
  A.ok(!Object.isFrozen(fork.acceptance[0]), 'fork rows are plain editable copies');
  const ex = R.exportRecipe(r);
  A.eq(ex.steps.length, 5, 'export carries steps');
  A.eq(ex.acceptance.length, 5, 'export carries acceptance');
  A.ok(!Object.isFrozen(ex.acceptance[0]), 'export rows are plain copies');
  const im = R.validateImport(JSON.parse(JSON.stringify(ex)));
  A.ok(im.ok, 'export re-imports');
  A.eq(im.recipe.steps.length, 5, 'import carries steps');
  A.eq(im.recipe.acceptance.length, 5, 'import carries acceptance');
  // a hostile import cannot smuggle an absolute path or an unknown type past the normalizers
  const hostile = R.validateImport({ name: 'h', task: 'do it', acceptance: [{ type: 'shell_exec', command: 'rm -rf /' }, { type: 'artifact_exists', path: '/etc/passwd' }, 'x', null] });
  A.ok(hostile.ok, 'the import itself is accepted (it is just data)');
  A.eq(R.saveCustom(Object.assign({}, hostile.recipe, { id: undefined })).acceptance, [], 'but every hostile row is dropped on save');

  // ---- the dossier label helper ----
  A.eq(R.acceptanceLabel({ type: 'verification_passed', command: 'npm test' }), 'check passes: npm test', 'label for a command check');
  A.eq(R.acceptanceLabel({ type: 'artifact_exists', path: 'a.md', label: 'the brief exists' }), 'the brief exists', 'an authored label wins');
}

// ---- connector read-back rows (2026-08-22) ----
{
  const r = R.saveCustom(R.draft({ name: 'Invoice mail', task: 'Email the invoice to {client}', params: [{ key: 'client' }], acceptance: [
    { type: 'connector_readback', connector: 'gmail', tool: 'search_messages', args: '{"q":"to:{client} Invoice"}', contains: 'Invoice for {client}' },
    { type: 'connector_readback', connector: 'sheets', tool: 'get_values', args: { range: 'A1:B9' }, regex: '^{client},' },
    { type: 'connector_readback', connector: 'bad id!', tool: 'x', contains: 'y' },                     // bad slug -> dropped
    { type: 'connector_readback', connector: 'gmail', tool: 'search_messages' },                         // no expectation -> dropped
    { type: 'connector_readback', connector: 'gmail', tool: 'search_messages', contains: 'x', args: '{not json' },   // bad args -> dropped
    { type: 'connector_readback', connector: 'gmail', tool: 'search_messages', regex: '(' }              // bad regex -> dropped
  ] }));
  A.eq(r.acceptance.length, 2, 'only the two well-formed read-back rows survive');
  A.eq(r.acceptance[0].args, { q: 'to:{client} Invoice' }, 'JSON-text args are parsed into an object');
  A.ok(Object.isFrozen(r.acceptance[0].args), 'args are frozen with the row');
  const pcs = R.postconditionsFor(r, { client: 'acme' });
  A.eq(pcs.requirements[0], { id: 'sop-1', type: 'connector_readback', connector: 'gmail', tool: 'search_messages', args: { q: 'to:acme Invoice' }, contains: 'Invoice for acme' }, 'tokens fill inside args string values AND contains');
  A.eq(pcs.requirements[1], { id: 'sop-2', type: 'connector_readback', connector: 'sheets', tool: 'get_values', args: { range: 'A1:B9' }, regex: '^{client},' }, 'regex is carried verbatim (no token fill: a regex is a pattern)');
  A.eq(normalizeContract(pcs).errors, [], 'the sidecar normalizer accepts both read-back rows');
  A.ok(R.fillTask(r, { client: 'acme' }).indexOf('gmail › search_messages {"q":"to:acme Invoice"} shows "Invoice for acme"') >= 0, 'the directive states the read-back in plain words');
  const ex = R.validateImport(JSON.parse(JSON.stringify(R.exportRecipe(r))));
  A.eq(R.saveCustom(Object.assign({}, ex.recipe, { id: undefined })).acceptance.length, 2, 'read-back rows survive export/import');
}

A.report('recipes.sop');
