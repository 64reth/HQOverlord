'use strict';
const A = require('./_assert.js');
const { makeSkillRegistry } = require('../sidecar/skills/registry.js');
(async () => {
  const registry = makeSkillRegistry({ fetchDocument: async url => ({ url, text: JSON.stringify({
    format: 'starnet-skill-registry/v1', name: 'Team tap', skills: [
      { name: 'Release Review', description: 'Audit a release', sourceUrl: './release/SKILL.md', version: '2' },
      { name: 'Research', description: 'Find sources', sourceUrl: 'https://skills.example/research/SKILL.md' }
    ]
  }) }) });
  const found = await registry.search({ url: 'https://registry.example/index.json', query: 'release' });
  A.eq(found.entries.length, 1, 'registry search filters bounded entries');
  A.eq(found.entries[0].sourceUrl, 'https://registry.example/release/SKILL.md', 'registry package URLs resolve against the index');
  let error = ''; try { await registry.search({ url: 'http://registry.example/index.json' }); } catch (e) { error = e.message; }
  A.ok(/HTTPS/.test(error), 'non-HTTPS registries are refused');
  const discovered = await registry.discover({ site: 'https://registry.example/products/start', query: 'research' });
  A.eq(discovered.registryUrl, 'https://registry.example/.well-known/starnet-skills.json', 'well-known discovery uses the site origin');
  A.report('skill-registry.test.js');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
