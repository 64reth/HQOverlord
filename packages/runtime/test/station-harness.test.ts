import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanHarness,detectHarnesses} from '../src/index.ts';
for(const harness of ['openclaw','hermes'] as const)test('source '+harness+' home import reads only bounded regular whitelisted files, redacts keys and never writes the home',async()=>{
 const base=await mkdtemp(join(tmpdir(),'hq-harness-')),root=harness==='openclaw'?join(base,'workspace'):base;try{
  await mkdir(root,{recursive:true});await writeFile(join(root,'SOUL.md'),'# Imported archivist\nPrecise evidence worker');await writeFile(join(root,'AGENTS.md'),'Review actual evidence');await writeFile(join(root,'.env'),'DO_NOT_IMPORT=private-key');
  if(harness==='openclaw'){await writeFile(join(base,'openclaw.json'),'{agents:{defaults:{model:{primary:"openai/model-name"}}},api_key:"must-never-transfer"}');await writeFile(join(root,'MEMORY.md'),'password=must-never-transfer Evidence archive');}else{await mkdir(join(root,'memories'));await writeFile(join(root,'config.yaml'),'model:\n  default: openai/model-name\napi_key: must-never-transfer');await writeFile(join(root,'memories','MEMORY.md'),'password=must-never-transfer Evidence archive');}
  const preview=await scanHarness(harness,root);assert.equal(preview.ok,true);assert.equal(preview.instructions,'Review actual evidence');assert.doesNotMatch(JSON.stringify(preview),/must-never-transfer|DO_NOT_IMPORT/);assert.ok(preview.warnings?.some(x=>/keys never transfer/i.test(x)));assert.equal(await readFile(join(root,'.env'),'utf8'),'DO_NOT_IMPORT=private-key');
  await assert.rejects(scanHarness(harness,'//remote/share'),/local/);await assert.rejects(scanHarness(harness,'relative'),/local/);
  const found=await detectHarnesses(process.platform,harness==='openclaw'?{OPENCLAW_STATE_DIR:base}:{HERMES_HOME:base});assert.ok(found.some(x=>x.root===root));
 }finally{await rm(base,{recursive:true,force:true});}
});
