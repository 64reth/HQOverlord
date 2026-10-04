/* dev/stage-implement-preview.js — stage ONE realistic PLAN deliverable in the dev seed's scratch workspace so
   the Implement flow can be previewed without waiting for (or paying for) a real night shift.

   It writes the deliverable files into the agent's jail and registers the backlog item through the REAL
   workshop-store module (never hand-rolled JSON), so /pending, the delivery card, and the decide/implement
   routes see exactly what a genuine shift would have produced.

   node dev/stage-implement-preview.js          # stage it
   node dev/stage-implement-preview.js --clear  # remove the staged item (leaves the run dir archive)          */
'use strict';

const fs = require('fs');
const path = require('path');
const { makeWorkshopStore } = require('../sidecar/workshop-store.js');

const WORKSPACES = path.resolve(__dirname, '.scratch-workspace');
const AGENT = 'agent';
// UNIQUE PER RUN: Discard permanently denylists a backlogId AND its normalised title (by design — "discard =
// never again"), so a fixed id would make every re-stage after a discard silently no-op. The title varies too.
const STAMP = String(Date.now()).slice(-6);
const RUN_ID = 'preview-plan-' + STAMP;
const BACKLOG_ID = 'preview-plan-item-' + STAMP;

// same shape the sidecar injects: writeDurable(deps, file, data) — deps first, NOT (file, data).
const writeDurable = (_deps, file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const store = makeWorkshopStore({ fs, path, workspaces: WORKSPACES, writeDurable, warn: () => {} });

const PLAN = `# Recent-work automation backlog

Three repeated questions from the last two weeks that a small tool could answer once and for all.
Each entry names its trigger, what it needs, and what it produces.

## 1. Machine snapshot  (PowerShell, ~30 min)
**Trigger:** "what graphics card is in this thing?", "can you see the specs of the PC you're running on?"
**Needs:** nothing — reads local WMI only.
**Produces:** a one-screen summary — CPU, GPU, RAM, disk free, OS build, uptime.
**Notes:** redact serial numbers before printing.

## 2. Disk pressure report  (PowerShell, ~45 min)
**Trigger:** "why is my C: drive full again?"
**Needs:** read access to the drive being reported on.
**Produces:** the top 20 directories by size, with a delta against the previous run.

## 3. Open-window census  (StarNet tool, ~2 h)
**Trigger:** "what was I working on yesterday?"
**Needs:** a background sampler and somewhere to persist samples.
**Produces:** a rollup of active windows per hour.

**Build order:** 1 before 2 (they share the formatting helper); 3 is independent and much larger.
`;

const MANIFEST = {
  v: 1, runId: RUN_ID, agentId: AGENT, backlogId: BACKLOG_ID,
  title: 'Recent-work automation backlog #' + STAMP, kind: 'doc', planOnly: true,
  summary: 'A short backlog turning repeated workstation questions into concrete automation candidates. Each candidate has a trigger, required context, output, and effort estimate.',
  files: [{ path: 'automation-backlog.md', bytes: Buffer.byteLength(PLAN, 'utf8') }],
  howToUse: 'Open automation-backlog.md.',
  notVerified: [
    'Confirm the Windows fields available in the intended StarNet runtime.',
    'Review redaction behaviour on a real machine.',
    'Choose which candidate to build first.'
  ]
};

(async () => {
  const runDir = path.join(WORKSPACES, AGENT, 'workshop', RUN_ID);

  if (process.argv.indexOf('--clear') >= 0) {
    // NOT remove(): it refuses a BUILT item by design (a built deliverable must be DECIDED, not silently
    // dropped). complete() retires it exactly like a keep does — /pending stops listing it, the run-dir
    // archive stays, and nothing is denylisted, so a re-stage is never blocked.
    const staged = (store.read(AGENT).backlog || []).filter(b => String(b.id || '').indexOf('preview-plan-item') === 0);
    for (const b of staged) await store.complete(AGENT, b.id).catch(() => {});
    console.log('retired ' + staged.length + ' staged preview item(s) (run-dir archives left in place)');
    return;
  }

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'automation-backlog.md'), PLAN, 'utf8');
  fs.writeFileSync(path.join(runDir, 'deliverable.json'), JSON.stringify(MANIFEST, null, 2) + '\n', 'utf8');

  // through the real store so the shape can never drift from what a genuine shift writes.
  await store.setGrant(AGENT, true, Date.now()).catch(() => {});
  await store.queue(AGENT, {
    id: BACKLOG_ID, title: MANIFEST.title, detail: 'A backlog of automation candidates.', source: 'nightshift',
    grounds: 'you asked "what graphics card?" and "can you see the specs of my PC?" more than once this fortnight'
  }, Date.now());
  await store.markBuilt(AGENT, BACKLOG_ID, RUN_ID, Date.now());

  const rec = store.read(AGENT);
  const item = (rec.backlog || []).find(b => b.id === BACKLOG_ID);
  console.log('staged: ' + MANIFEST.title);
  console.log('  run dir : ' + runDir);
  console.log('  pending : ' + (item && item.builtRunId === RUN_ID ? 'yes (builtRunId set)' : 'NO — check the store'));
  console.log('  planOnly: ' + MANIFEST.planOnly + '  → Implement should offer to BUILD it');
})().catch(e => { console.error(e); process.exit(1); });
